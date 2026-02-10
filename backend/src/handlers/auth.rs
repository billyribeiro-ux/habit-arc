use axum::{extract::State, Extension, Json};
use chrono::{Duration, Utc};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::{
    jwt::{create_token_pair, hash_token, verify_token, TokenPair, TokenType},
    middleware::AuthUser,
    password::{hash_password, verify_password},
};
use crate::error::{AppError, AppResult};
use crate::models::user::{SubscriptionStatus, SubscriptionTier, UserProfile};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub name: String,
    pub guest_token: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct GuestRequest {
    pub timezone: Option<String>,
}

/// Store a refresh token hash in the DB, optionally linking to a parent token.
/// Public wrapper for use by demo conversion handler.
pub async fn store_refresh_token_pub(
    db: &sqlx::PgPool,
    user_id: Uuid,
    raw_refresh_token: &str,
    ttl_secs: i64,
    parent_token_id: Option<Uuid>,
) -> AppResult<Uuid> {
    store_refresh_token(db, user_id, raw_refresh_token, ttl_secs, parent_token_id).await
}

async fn store_refresh_token(
    db: &sqlx::PgPool,
    user_id: Uuid,
    raw_refresh_token: &str,
    ttl_secs: i64,
    parent_token_id: Option<Uuid>,
) -> AppResult<Uuid> {
    let token_hash = hash_token(raw_refresh_token);
    let expires_at = Utc::now() + Duration::seconds(ttl_secs);
    let id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, parent_token_id)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(&token_hash)
    .bind(expires_at)
    .bind(parent_token_id)
    .execute(db)
    .await?;

    Ok(id)
}

/// Create a token pair AND persist the refresh token hash in the DB.
async fn issue_token_pair(
    db: &sqlx::PgPool,
    user_id: Uuid,
    email: &str,
    config: &crate::config::Config,
    parent_token_id: Option<Uuid>,
) -> AppResult<TokenPair> {
    let tokens = create_token_pair(user_id, email, config)?;
    store_refresh_token(
        db,
        user_id,
        &tokens.refresh_token,
        config.jwt_refresh_ttl_secs,
        parent_token_id,
    )
    .await?;
    Ok(tokens)
}

/// Revoke all active refresh tokens for a user.
async fn revoke_all_user_tokens(db: &sqlx::PgPool, user_id: Uuid) -> AppResult<()> {
    sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET revoked = true, revoked_at = NOW()
        WHERE user_id = $1 AND revoked = false
        "#,
    )
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> AppResult<Json<TokenPair>> {
    if body.email.is_empty() || body.password.len() < 8 {
        return Err(AppError::Validation(
            "Email required and password must be at least 8 characters".into(),
        ));
    }

    let existing = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = $1")
        .bind(&body.email)
        .fetch_one(&state.db)
        .await?;

    if existing > 0 {
        return Err(AppError::Conflict("Email already registered".into()));
    }

    let pwd_hash = hash_password(&body.password)?;

    // If guest_token provided, merge guest account into full account
    if let Some(guest_token) = body.guest_token {
        let guest = sqlx::query_as::<_, crate::models::user::User>(
            "SELECT * FROM users WHERE guest_token = $1 AND is_guest = true",
        )
        .bind(guest_token)
        .fetch_optional(&state.db)
        .await?;

        if let Some(guest) = guest {
            sqlx::query(
                r#"
                UPDATE users SET
                    email = $2, password_hash = $3, name = $4,
                    is_guest = false, guest_token = NULL, updated_at = NOW()
                WHERE id = $1
                "#,
            )
            .bind(guest.id)
            .bind(&body.email)
            .bind(&pwd_hash)
            .bind(&body.name)
            .execute(&state.db)
            .await?;

            let tokens = issue_token_pair(&state.db, guest.id, &body.email, &state.config, None).await?;
            return Ok(Json(tokens));
        }
    }

    let user_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO users (id, email, password_hash, name, subscription_tier, subscription_status)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(user_id)
    .bind(&body.email)
    .bind(&pwd_hash)
    .bind(&body.name)
    .bind(SubscriptionTier::Free)
    .bind(SubscriptionStatus::Active)
    .execute(&state.db)
    .await?;

    let tokens = issue_token_pair(&state.db, user_id, &body.email, &state.config, None).await?;
    Ok(Json(tokens))
}

pub async fn guest(
    State(state): State<AppState>,
    Json(body): Json<GuestRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let user_id = Uuid::new_v4();
    let guest_token = Uuid::new_v4();
    let timezone = body.timezone.unwrap_or_else(|| "UTC".to_string());

    sqlx::query(
        r#"
        INSERT INTO users (id, name, is_guest, guest_token, timezone, subscription_tier, subscription_status)
        VALUES ($1, $2, true, $3, $4, $5, $6)
        "#,
    )
    .bind(user_id)
    .bind("Guest")
    .bind(guest_token)
    .bind(&timezone)
    .bind(SubscriptionTier::Free)
    .bind(SubscriptionStatus::Active)
    .execute(&state.db)
    .await?;

    let tokens = issue_token_pair(&state.db, user_id, "", &state.config, None).await?;

    Ok(Json(serde_json::json!({
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "expires_in": tokens.expires_in,
        "guest_token": guest_token,
    })))
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> AppResult<Json<TokenPair>> {
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE email = $1 AND is_guest = false",
    )
    .bind(&body.email)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let password_hash = user.password_hash.as_deref().ok_or(AppError::Unauthorized)?;
    if !verify_password(&body.password, password_hash)? {
        return Err(AppError::Unauthorized);
    }

    let email = user.email.as_deref().unwrap_or("");
    let tokens = issue_token_pair(&state.db, user.id, email, &state.config, None).await?;
    Ok(Json(tokens))
}

pub async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> AppResult<Json<TokenPair>> {
    let token_data = verify_token(&body.refresh_token, &state.config)?;

    if token_data.claims.token_type != TokenType::Refresh {
        return Err(AppError::Unauthorized);
    }

    // Look up the refresh token hash in the DB
    let token_hash = hash_token(&body.refresh_token);

    let stored = sqlx::query_as::<_, (Uuid, Uuid, bool)>(
        r#"
        SELECT id, user_id, revoked
        FROM refresh_tokens
        WHERE token_hash = $1
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let (stored_id, stored_user_id, revoked) = stored;

    // Reuse detection: if a revoked token is presented, revoke the entire family
    if revoked {
        tracing::warn!(
            user_id = %stored_user_id,
            token_id = %stored_id,
            "Refresh token reuse detected — revoking all tokens for user"
        );
        revoke_all_user_tokens(&state.db, stored_user_id).await?;
        return Err(AppError::Unauthorized);
    }

    // Verify the token belongs to the claimed user
    if stored_user_id != token_data.claims.sub {
        return Err(AppError::Unauthorized);
    }

    // Revoke the current token (single-use rotation)
    sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET revoked = true, revoked_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(stored_id)
    .execute(&state.db)
    .await?;

    // Issue new token pair, linking to the parent
    let tokens = issue_token_pair(
        &state.db,
        token_data.claims.sub,
        &token_data.claims.email,
        &state.config,
        Some(stored_id),
    )
    .await?;
    Ok(Json(tokens))
}

pub async fn logout(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<serde_json::Value>> {
    revoke_all_user_tokens(&state.db, auth_user.id).await?;
    Ok(Json(serde_json::json!({ "message": "Logged out successfully" })))
}

pub async fn me(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> AppResult<Json<UserProfile>> {
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE id = $1",
    )
    .bind(auth_user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("User not found".into()))?;

    Ok(Json(user.into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_token_deterministic() {
        let token = "test-refresh-token-value";
        let h1 = hash_token(token);
        let h2 = hash_token(token);
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // SHA-256 hex = 64 chars
    }

    #[test]
    fn test_hash_token_different_inputs() {
        let h1 = hash_token("token-a");
        let h2 = hash_token("token-b");
        assert_ne!(h1, h2);
    }
}
