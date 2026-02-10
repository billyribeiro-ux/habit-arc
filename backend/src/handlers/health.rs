use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::AppState;

pub async fn health_check() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "habitarc-api",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

pub async fn readyz(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let db_ok = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();

    if db_ok {
        (
            StatusCode::OK,
            Json(json!({
                "status": "ready",
                "checks": { "database": "ok" },
            })),
        )
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "status": "not_ready",
                "checks": { "database": "failed" },
            })),
        )
    }
}
