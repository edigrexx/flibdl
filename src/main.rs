pub mod config;
pub mod services;
pub mod views;

use dotenvy::dotenv;

use std::net::SocketAddr;
use tracing::info;
use tracing_subscriber::{filter, layer::SubscriberExt, util::SubscriberInitExt};

use crate::views::get_router;

#[tokio::main]
async fn main() {
    dotenv().ok();

    // Sentry — опциональный
    let _guard = if let Some(ref dsn) = config::CONFIG.sentry_dsn {
        if !dsn.is_empty() {
            use sentry::{integrations::debug_images::DebugImagesIntegration, ClientOptions};
            let options = ClientOptions {
                dsn: Some(std::str::FromStr::from_str(dsn).unwrap()),
                default_integrations: false,
                ..Default::default()
            }
            .add_integration(DebugImagesIntegration::new());
            Some(sentry::init(options))
        } else {
            None
        }
    } else {
        None
    };

    // Sentry tracing layer — только если Sentry активен
    let sentry_layer = if _guard.is_some() {
        use sentry_tracing::EventFilter;
        Some(sentry_tracing::layer().event_filter(|md| match md.level() {
            &tracing::Level::ERROR => EventFilter::Event,
            _ => EventFilter::Ignore,
        }))
    } else {
        None
    };

    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .with(filter::LevelFilter::INFO)
        .with(sentry_layer)
        .init();

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));

    let app = get_router().await;

    info!("Start webserver...");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
    info!("Webserver shutdown...")
}
