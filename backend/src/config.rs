use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub host: String,
    pub port: u16,
    pub frontend_url: String,

    pub jwt_secret: String,
    pub jwt_access_ttl_secs: i64,
    pub jwt_refresh_ttl_secs: i64,

    pub stripe_secret_key: String,
    pub stripe_webhook_secret: String,

    pub claude_api_key: String,
    pub claude_model: String,

    pub sentry_dsn: Option<String>,

    // Demo / Try Me mode
    pub try_me_enabled: bool,
    pub demo_ttl_secs: i64,
    pub demo_max_insight_calls: i32,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: env::var("PORT")
                .unwrap_or_else(|_| "8080".into())
                .parse()
                .expect("PORT must be a number"),
            frontend_url: env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "http://localhost:3000".into()),

            jwt_secret: env::var("JWT_SECRET").expect("JWT_SECRET must be set"),
            jwt_access_ttl_secs: env::var("JWT_ACCESS_TTL_SECS")
                .unwrap_or_else(|_| "900".into())
                .parse()
                .expect("JWT_ACCESS_TTL_SECS must be a number"),
            jwt_refresh_ttl_secs: env::var("JWT_REFRESH_TTL_SECS")
                .unwrap_or_else(|_| "604800".into())
                .parse()
                .expect("JWT_REFRESH_TTL_SECS must be a number"),

            stripe_secret_key: env::var("STRIPE_SECRET_KEY")
                .unwrap_or_else(|_| String::new()),
            stripe_webhook_secret: env::var("STRIPE_WEBHOOK_SECRET")
                .unwrap_or_else(|_| String::new()),

            claude_api_key: env::var("CLAUDE_API_KEY").unwrap_or_else(|_| String::new()),
            claude_model: env::var("CLAUDE_MODEL")
                .unwrap_or_else(|_| "claude-sonnet-4-20250514".into()),

            sentry_dsn: env::var("SENTRY_DSN").ok().filter(|s| !s.is_empty()),

            try_me_enabled: env::var("TRY_ME_ENABLED")
                .unwrap_or_else(|_| "true".into())
                .parse()
                .unwrap_or(true),
            demo_ttl_secs: env::var("DEMO_TTL_SECS")
                .unwrap_or_else(|_| "7200".into()) // 2 hours
                .parse()
                .unwrap_or(7200),
            demo_max_insight_calls: env::var("DEMO_MAX_INSIGHT_CALLS")
                .unwrap_or_else(|_| "2".into())
                .parse()
                .unwrap_or(2),
        }
    }

    pub fn listen_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}
