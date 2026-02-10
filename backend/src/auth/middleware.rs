use axum::{
    extract::{Request, State},
    http::header::AUTHORIZATION,
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

use crate::error::AppError;
use crate::auth::jwt::{verify_token, TokenType};
use crate::AppState;

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    #[allow(dead_code)]
    pub email: Option<String>,
    pub is_demo: bool,
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let auth_header = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(AppError::Unauthorized)?;

    let token_data = verify_token(token, &state.config)?;

    if token_data.claims.token_type != TokenType::Access {
        return Err(AppError::Unauthorized);
    }

    let is_demo = token_data.claims.is_demo.unwrap_or(false);

    // Demo expiry is enforced by the JWT `exp` claim itself (set to demo_ttl_secs).
    // No additional DB check needed — JWT verification above already rejects expired tokens.

    let auth_user = AuthUser {
        id: token_data.claims.sub,
        email: if token_data.claims.email.is_empty() {
            None
        } else {
            Some(token_data.claims.email)
        },
        is_demo,
    };

    req.extensions_mut().insert(auth_user);
    Ok(next.run(req).await)
}
