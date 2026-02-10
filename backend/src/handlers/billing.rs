use axum::{
    body::Bytes,
    extract::State,
    http::HeaderMap,
    Extension, Json,
};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::auth::middleware::AuthUser;
use crate::error::{AppError, AppResult};
use crate::models::user::{SubscriptionStatus, SubscriptionTier};
use crate::AppState;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize)]
pub struct CheckoutResponse {
    pub checkout_url: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateCheckoutRequest {
    pub price_id: String,
}

#[derive(Debug, Serialize)]
pub struct SubscriptionInfo {
    pub tier: SubscriptionTier,
    pub status: SubscriptionStatus,
    pub stripe_customer_id: Option<String>,
}

pub async fn get_subscription(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<SubscriptionInfo>> {
    let (tier, status, stripe_id) = sqlx::query_as::<_, (SubscriptionTier, SubscriptionStatus, Option<String>)>(
        "SELECT subscription_tier, subscription_status, stripe_customer_id FROM users WHERE id = $1",
    )
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(SubscriptionInfo {
        tier,
        status,
        stripe_customer_id: stripe_id,
    }))
}

pub async fn create_checkout(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(body): Json<CreateCheckoutRequest>,
) -> AppResult<Json<CheckoutResponse>> {
    // Block billing checkout for demo users
    if auth_user.is_demo {
        return Err(AppError::Forbidden);
    }

    if state.config.stripe_secret_key.is_empty() {
        return Err(AppError::Internal(anyhow::anyhow!(
            "Stripe not configured"
        )));
    }

    // Get or create Stripe customer
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE id = $1",
    )
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await?;

    let customer_id = if let Some(cid) = &user.stripe_customer_id {
        cid.clone()
    } else {
        // Create Stripe customer via API
        let client = reqwest::Client::new();
        let resp = client
            .post("https://api.stripe.com/v1/customers")
            .header(
                "Authorization",
                format!("Bearer {}", state.config.stripe_secret_key),
            )
            .form(&[
                ("email", user.email.as_deref().unwrap_or("")),
                ("name", user.name.as_str()),
            ])
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Stripe error: {}", e)))?;

        let customer: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Stripe parse error: {}", e)))?;

        let cid = customer["id"]
            .as_str()
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("No customer ID from Stripe")))?
            .to_string();

        sqlx::query("UPDATE users SET stripe_customer_id = $2 WHERE id = $1")
            .bind(auth_user.id)
            .bind(&cid)
            .execute(&state.db)
            .await?;

        cid
    };

    // Create checkout session
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.stripe.com/v1/checkout/sessions")
        .header(
            "Authorization",
            format!("Bearer {}", state.config.stripe_secret_key),
        )
        .form(&[
            ("customer", customer_id.as_str()),
            ("mode", "subscription"),
            ("line_items[0][price]", &body.price_id),
            ("line_items[0][quantity]", "1"),
            (
                "success_url",
                &format!("{}/billing?success=true", state.config.frontend_url),
            ),
            (
                "cancel_url",
                &format!("{}/billing?canceled=true", state.config.frontend_url),
            ),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Stripe error: {}", e)))?;

    let session: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Stripe parse error: {}", e)))?;

    let url = session["url"]
        .as_str()
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("No checkout URL from Stripe")))?
        .to_string();

    Ok(Json(CheckoutResponse { checkout_url: url }))
}

/// Verify Stripe webhook signature.
/// Header format: t=timestamp,v1=signature[,v1=signature...]
fn verify_stripe_signature(
    payload: &[u8],
    signature_header: &str,
    secret: &str,
) -> Result<(), AppError> {
    let mut timestamp: Option<&str> = None;
    let mut signatures: Vec<&str> = Vec::new();

    for part in signature_header.split(',') {
        let mut kv = part.splitn(2, '=');
        match (kv.next(), kv.next()) {
            (Some("t"), Some(ts)) => timestamp = Some(ts),
            (Some("v1"), Some(sig)) => signatures.push(sig),
            _ => {}
        }
    }

    let ts = timestamp.ok_or_else(|| {
        AppError::Validation("Missing timestamp in Stripe-Signature".into())
    })?;

    if signatures.is_empty() {
        return Err(AppError::Validation(
            "Missing v1 signature in Stripe-Signature".into(),
        ));
    }

    // Construct the signed payload: "timestamp.payload"
    let signed_payload = format!("{}.{}", ts, String::from_utf8_lossy(payload));

    // Compute expected signature
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| AppError::Internal(anyhow::anyhow!("Invalid webhook secret")))?;
    mac.update(signed_payload.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());

    // Check if any provided signature matches
    let valid = signatures.iter().any(|sig| {
        // Constant-time comparison to prevent timing attacks
        sig.len() == expected.len()
            && sig
                .as_bytes()
                .iter()
                .zip(expected.as_bytes())
                .fold(0u8, |acc, (a, b)| acc | (a ^ b))
                == 0
    });

    if !valid {
        return Err(AppError::Validation("Invalid Stripe webhook signature".into()));
    }

    // Optional: Check timestamp is within tolerance (e.g., 5 minutes)
    if let Ok(ts_secs) = ts.parse::<i64>() {
        let now = chrono::Utc::now().timestamp();
        let tolerance = 300; // 5 minutes
        if (now - ts_secs).abs() > tolerance {
            return Err(AppError::Validation(
                "Stripe webhook timestamp outside tolerance".into(),
            ));
        }
    }

    Ok(())
}

pub async fn stripe_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Json<serde_json::Value>> {
    // B-11: Verify webhook signature
    if !state.config.stripe_webhook_secret.is_empty() {
        let sig_header = headers
            .get("stripe-signature")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Validation("Missing Stripe-Signature header".into()))?;

        verify_stripe_signature(&body, sig_header, &state.config.stripe_webhook_secret)?;
    } else {
        tracing::warn!("Stripe webhook secret not configured — signature verification skipped");
    }

    let event: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| AppError::Validation(format!("Invalid webhook payload: {}", e)))?;

    let event_id = event["id"].as_str().unwrap_or("");
    let event_type = event["type"].as_str().unwrap_or("");

    // G-18: Deduplicate events
    if !event_id.is_empty() {
        let already_processed = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM stripe_events WHERE event_id = $1",
        )
        .bind(event_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if already_processed > 0 {
            tracing::debug!(event_id = event_id, "Stripe event already processed, skipping");
            return Ok(Json(serde_json::json!({ "received": true, "duplicate": true })));
        }

        let _ = sqlx::query(
            "INSERT INTO stripe_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(event_id)
        .bind(event_type)
        .execute(&state.db)
        .await;
    }

    tracing::info!(event_type = event_type, event_id = event_id, "Stripe webhook received");

    match event_type {
        "checkout.session.completed" => {
            let customer_id = event["data"]["object"]["customer"]
                .as_str()
                .unwrap_or("");

            // Determine tier from metadata or default to plus
            let tier = event["data"]["object"]["metadata"]["tier"]
                .as_str()
                .unwrap_or("plus");

            let tier_value = match tier {
                "pro" => "pro",
                _ => "plus",
            };

            sqlx::query(
                r#"
                UPDATE users SET
                    subscription_tier = $2::subscription_tier,
                    subscription_status = 'active',
                    updated_at = NOW()
                WHERE stripe_customer_id = $1
                "#,
            )
            .bind(customer_id)
            .bind(tier_value)
            .execute(&state.db)
            .await?;
        }
        "customer.subscription.updated" => {
            let customer_id = event["data"]["object"]["customer"]
                .as_str()
                .unwrap_or("");
            let status = event["data"]["object"]["status"]
                .as_str()
                .unwrap_or("active");

            let sub_status = match status {
                "active" => "active",
                "trialing" => "trialing",
                "past_due" => "past_due",
                "canceled" => "canceled",
                _ => "inactive",
            };

            sqlx::query(
                r#"
                UPDATE users SET
                    subscription_status = $2::subscription_status,
                    updated_at = NOW()
                WHERE stripe_customer_id = $1
                "#,
            )
            .bind(customer_id)
            .bind(sub_status)
            .execute(&state.db)
            .await?;
        }
        "customer.subscription.deleted" => {
            let customer_id = event["data"]["object"]["customer"]
                .as_str()
                .unwrap_or("");

            sqlx::query(
                r#"
                UPDATE users SET
                    subscription_tier = 'free',
                    subscription_status = 'canceled',
                    updated_at = NOW()
                WHERE stripe_customer_id = $1
                "#,
            )
            .bind(customer_id)
            .execute(&state.db)
            .await?;
        }
        _ => {
            tracing::debug!(event_type = event_type, "Unhandled Stripe event");
        }
    }

    Ok(Json(serde_json::json!({ "received": true })))
}
