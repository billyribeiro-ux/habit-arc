use axum::{
    extract::{ConnectInfo, Request, State},
    middleware::Next,
    response::Response,
};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::AppState;

/// Rate limiter configuration
const MAX_REQUESTS: u32 = 5; // Max requests per window
const WINDOW_SECS: u64 = 60; // Window duration in seconds

/// In-memory rate limit state (for single-instance deployments)
/// For multi-instance, use Redis or similar
#[derive(Clone, Default)]
pub struct RateLimitState {
    entries: Arc<Mutex<HashMap<String, RateLimitEntry>>>,
}

struct RateLimitEntry {
    count: u32,
    window_start: Instant,
}

impl RateLimitState {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Check if the key is rate limited. Returns Ok(remaining) or Err if limited.
    pub async fn check(&self, key: &str) -> Result<u32, Duration> {
        self.check_with_limits(key, MAX_REQUESTS, WINDOW_SECS).await
    }

    /// Check with custom limits.
    pub async fn check_with_limits(&self, key: &str, max_requests: u32, window_secs: u64) -> Result<u32, Duration> {
        let mut entries = self.entries.lock().await;
        let now = Instant::now();
        let window = Duration::from_secs(window_secs);

        let entry = entries.entry(key.to_string()).or_insert(RateLimitEntry {
            count: 0,
            window_start: now,
        });

        // Reset window if expired
        if now.duration_since(entry.window_start) > window {
            entry.count = 0;
            entry.window_start = now;
        }

        if entry.count >= max_requests {
            let retry_after = window.saturating_sub(now.duration_since(entry.window_start));
            return Err(retry_after);
        }

        entry.count += 1;
        Ok(max_requests - entry.count)
    }

    /// Periodically clean up expired entries (call from a background task)
    pub async fn cleanup(&self) {
        let mut entries = self.entries.lock().await;
        let now = Instant::now();
        let window = Duration::from_secs(WINDOW_SECS * 2); // Keep for 2x window

        entries.retain(|_, entry| now.duration_since(entry.window_start) < window);
    }
}

/// Rate limiting middleware for auth endpoints
pub async fn rate_limit_auth(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let ip = addr.ip().to_string();
    let path = req.uri().path().to_string();
    
    // Rate limit key: IP + path (so /login and /register have separate limits)
    let key = format!("{}:{}", ip, path);

    match state.rate_limiter.check(&key).await {
        Ok(remaining) => {
            tracing::debug!(ip = %ip, path = %path, remaining = remaining, "Rate limit check passed");
            Ok(next.run(req).await)
        }
        Err(retry_after) => {
            let secs: u64 = retry_after.as_secs();
            tracing::warn!(
                ip = %ip,
                path = %path,
                retry_after_secs = secs,
                "Rate limit exceeded"
            );
            Err(AppError::RateLimited)
        }
    }
}

/// Stricter rate limiting for demo start endpoint: 3 requests per IP per hour
pub async fn rate_limit_demo(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let ip = addr.ip().to_string();
    let key = format!("demo:{}", ip);

    match state.rate_limiter.check_with_limits(&key, 3, 3600).await {
        Ok(remaining) => {
            tracing::debug!(ip = %ip, remaining = remaining, "Demo rate limit check passed");
            Ok(next.run(req).await)
        }
        Err(retry_after) => {
            let secs: u64 = retry_after.as_secs();
            tracing::warn!(
                ip = %ip,
                retry_after_secs = secs,
                "Demo rate limit exceeded"
            );
            Err(AppError::RateLimited)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_rate_limit_allows_under_limit() {
        let limiter = RateLimitState::new();
        
        for i in 0..MAX_REQUESTS {
            let result = limiter.check("test_key").await;
            assert!(result.is_ok(), "Request {} should be allowed", i + 1);
        }
    }

    #[tokio::test]
    async fn test_rate_limit_blocks_over_limit() {
        let limiter = RateLimitState::new();
        
        // Exhaust the limit
        for _ in 0..MAX_REQUESTS {
            let _ = limiter.check("test_key").await;
        }
        
        // Next request should be blocked
        let result = limiter.check("test_key").await;
        assert!(result.is_err(), "Request over limit should be blocked");
    }

    #[tokio::test]
    async fn test_different_keys_have_separate_limits() {
        let limiter = RateLimitState::new();
        
        // Exhaust limit for key1
        for _ in 0..MAX_REQUESTS {
            let _ = limiter.check("key1").await;
        }
        
        // key2 should still be allowed
        let result = limiter.check("key2").await;
        assert!(result.is_ok(), "Different key should have separate limit");
    }
}
