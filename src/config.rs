use once_cell::sync::Lazy;
use serde::Deserialize;

fn get_env(env: &'static str) -> String {
    std::env::var(env).unwrap_or_else(|_| panic!("Cannot get the {} env variable", env))
}

fn get_env_opt(env: &'static str) -> Option<String> {
    std::env::var(env).ok()
}

#[derive(Deserialize, Clone)]
pub struct SourceConfig {
    pub url: String,
    pub proxy: Option<String>,
}

pub struct Config {
    pub api_key: String,
    pub fl_sources: Vec<SourceConfig>,
    pub sentry_dsn: Option<String>,
}

impl Config {
    pub fn load() -> Config {
        Config {
            api_key: get_env("API_KEY"),
            fl_sources: get_env_opt("FL_SOURCES")
                .and_then(|val| serde_json::from_str(&val).ok())
                .unwrap_or_else(|| {
                    tracing::warn!("⚠️ FL_SOURCES env parsing failed or missing, using default https://flibusta.is");
                    vec![SourceConfig {
                        url: "https://flibusta.is".to_string(),
                        proxy: None,
                    }]
                }),
            sentry_dsn: get_env_opt("SENTRY_DSN"),
        }
    }
}

pub static CONFIG: Lazy<Config> = Lazy::new(Config::load);
