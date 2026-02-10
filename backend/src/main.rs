use axum::{
    middleware,
    routing::{delete, get, post, put},
    Router,
};
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

mod auth;
mod config;
mod db;
mod error;
mod handlers;
mod models;
mod services;

use auth::rate_limit::RateLimitState;
use config::Config;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub ws_tx: Option<broadcast::Sender<String>>,
    pub rate_limiter: RateLimitState,
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "habitarc_api=debug,tower_http=debug".into()),
        )
        .json()
        .init();

    let config = Config::from_env();
    let config = Arc::new(config);

    // Database
    let db = db::create_pool(&config.database_url).await;

    // Run migrations
    sqlx::migrate!("./migrations_v2")
        .run(&db)
        .await
        .expect("Failed to run database migrations");

    tracing::info!("Database migrations applied");

    // WebSocket broadcast channel
    let (ws_tx, _) = broadcast::channel::<String>(256);

    let rate_limiter = RateLimitState::new();

    let state = AppState {
        db,
        config: config.clone(),
        ws_tx: Some(ws_tx),
        rate_limiter,
    };

    // Build routes
    // B-10: Auth routes with rate limiting
    let auth_routes = Router::new()
        .route("/api/auth/register", post(handlers::auth::register))
        .route("/api/auth/login", post(handlers::auth::login))
        .route("/api/auth/refresh", post(handlers::auth::refresh))
        .route("/api/auth/guest", post(handlers::auth::guest))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::rate_limit::rate_limit_auth,
        ));

    // Demo start: public but with strict rate limiting (3 req/IP/hour)
    let demo_public_routes = Router::new()
        .route("/api/demo/start", post(handlers::demo::start_demo))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::rate_limit::rate_limit_demo,
        ));

    let public_routes = Router::new()
        .route("/health", get(handlers::health::health_check))
        .route("/readyz", get(handlers::health::readyz))
        .route(
            "/api/billing/webhook",
            post(handlers::billing::stripe_webhook),
        )
        .route("/ws", get(handlers::ws::ws_handler))
        .merge(demo_public_routes)
        .merge(auth_routes);

    let protected_routes = Router::new()
        .route("/api/me", get(handlers::auth::me))
        // Habits
        .route("/api/habits", get(handlers::habits::list_habits))
        .route("/api/habits", post(handlers::habits::create_habit))
        .route("/api/habits/:id", get(handlers::habits::get_habit))
        .route("/api/habits/:id", put(handlers::habits::update_habit))
        .route("/api/habits/:id", delete(handlers::habits::delete_habit))
        // Completions
        .route(
            "/api/completions",
            post(handlers::completions::create_completion),
        )
        .route(
            "/api/completions",
            get(handlers::completions::list_completions),
        )
        .route(
            "/api/completions/:id",
            delete(handlers::completions::delete_completion),
        )
        .route(
            "/api/completions/toggle",
            post(handlers::completions::toggle_completion),
        )
        // Stats & Streaks
        .route(
            "/api/habits/:id/streak",
            get(handlers::completions::get_streak),
        )
        .route(
            "/api/habits/:id/heatmap",
            get(handlers::completions::get_heatmap),
        )
        .route("/api/stats/daily", get(handlers::completions::get_daily_stats))
        .route("/api/stats/weekly-review", get(handlers::completions::get_weekly_review))
        // Daily Logs
        .route("/api/daily-logs", post(handlers::daily_logs::upsert_daily_log))
        .route("/api/daily-logs", get(handlers::daily_logs::list_daily_logs))
        // Insights
        .route("/api/insights", get(handlers::insights::get_insights))
        // Billing
        .route(
            "/api/billing/subscription",
            get(handlers::billing::get_subscription),
        )
        .route(
            "/api/billing/checkout",
            post(handlers::billing::create_checkout),
        )
        // Auth actions requiring a session
        .route("/api/auth/logout", post(handlers::auth::logout))
        // Demo routes (require auth, demo middleware checks is_demo)
        .route("/api/demo/status", get(handlers::demo::demo_status))
        .route("/api/demo/reset", post(handlers::demo::reset_demo))
        .route("/api/demo/convert", post(handlers::demo::convert_demo))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::middleware::require_auth,
        ));

    let allowed_origins: Vec<axum::http::HeaderValue> = {
        let mut origins = vec![config
            .frontend_url
            .parse::<axum::http::HeaderValue>()
            .unwrap()];
        // In dev, also allow LAN access (e.g. testing from another device)
        if let Ok(extra) = std::env::var("CORS_EXTRA_ORIGINS") {
            for o in extra.split(',') {
                if let Ok(hv) = o.trim().parse::<axum::http::HeaderValue>() {
                    origins.push(hv);
                }
            }
        }
        origins
    };
    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
        ])
        .allow_credentials(true);

    // Start demo cleanup worker (purges expired demo sessions every 5 min)
    handlers::demo::spawn_demo_cleanup_worker(state.db.clone());

    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = config.listen_addr();
    tracing::info!("Starting server on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    // Use into_make_service_with_connect_info to provide client IP for rate limiting
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .unwrap();
}
