use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, TokenData, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::config::Config;
use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: Uuid,
    pub email: String,
    pub exp: i64,
    pub iat: i64,
    pub token_type: TokenType,
    #[serde(default)]
    pub jti: Option<Uuid>,
    #[serde(default)]
    pub is_demo: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TokenType {
    Access,
    Refresh,
}

#[derive(Debug, Serialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

pub fn create_access_token(user_id: Uuid, email: &str, config: &Config) -> AppResult<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        email: email.to_string(),
        exp: (now + Duration::seconds(config.jwt_access_ttl_secs)).timestamp(),
        iat: now.timestamp(),
        token_type: TokenType::Access,
        jti: None,
        is_demo: None,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to create access token: {}", e)))
}

pub fn create_refresh_token(user_id: Uuid, email: &str, config: &Config) -> AppResult<String> {
    let now = Utc::now();
    let jti = Uuid::new_v4();
    let claims = Claims {
        sub: user_id,
        email: email.to_string(),
        exp: (now + Duration::seconds(config.jwt_refresh_ttl_secs)).timestamp(),
        iat: now.timestamp(),
        token_type: TokenType::Refresh,
        jti: Some(jti),
        is_demo: None,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to create refresh token: {}", e)))
}

pub fn create_token_pair(user_id: Uuid, email: &str, config: &Config) -> AppResult<TokenPair> {
    let access_token = create_access_token(user_id, email, config)?;
    let refresh_token = create_refresh_token(user_id, email, config)?;

    Ok(TokenPair {
        access_token,
        refresh_token,
        expires_in: config.jwt_access_ttl_secs,
    })
}

/// Create a short-lived demo access token with is_demo=true claim.
pub fn create_demo_access_token(user_id: Uuid, ttl_secs: i64, config: &Config) -> AppResult<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        email: String::new(),
        exp: (now + Duration::seconds(ttl_secs)).timestamp(),
        iat: now.timestamp(),
        token_type: TokenType::Access,
        jti: None,
        is_demo: Some(true),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to create demo token: {}", e)))
}

/// Compute SHA-256 hash of a raw token string, returned as lowercase hex.
pub fn hash_token(raw_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw_token.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn verify_token(token: &str, config: &Config) -> AppResult<TokenData<Claims>> {
    let mut validation = Validation::default();
    validation.validate_exp = true;

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| AppError::Unauthorized)
}
