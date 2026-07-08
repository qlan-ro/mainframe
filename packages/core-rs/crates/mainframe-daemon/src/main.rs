//! Ported from `src/index.ts`, `src/cli/*` (packages/core).
//!
//! Scaffold: boots the axum app from `mainframe-server` with only `GET /health`
//! wired, and shuts down gracefully on SIGTERM/SIGINT. CLI subcommands
//! (`pair`/`status`) are TODO(port) for a later phase.
#![forbid(unsafe_code)]

use mainframe_server::http::{AppState, build_router};
use tokio::signal;
use tracing::info;

const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main]
async fn main() {
    let _log_guard = mainframe_runtime::logging::init();
    let port = mainframe_runtime::config::resolve_port();

    let state = AppState {
        version: DAEMON_VERSION.to_string(),
        tunnel_url: None,
    };
    let app = build_router(state);

    let addr = format!("0.0.0.0:{port}");
    // Boot failures (bad bind address, port already in use) abort the process;
    // there is no supervisor to hand a Result back to at this point in the
    // scaffold, matching `src/index.ts`'s top-level listen() failure behavior.
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => listener,
        Err(err) => {
            tracing::error!(%err, %addr, "failed to bind daemon listener");
            std::process::exit(1);
        }
    };
    info!(%addr, version = DAEMON_VERSION, "mainframe-daemon listening");

    if let Err(err) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        tracing::error!(%err, "daemon server exited with error");
        std::process::exit(1);
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        // Boot-time signal handler installation failure is unrecoverable — the
        // process has no path forward without it — so this is treated as a
        // fatal boot condition per the RUST RULES exemption for main.rs boot.
        #[allow(clippy::expect_used)]
        signal::ctrl_c()
            .await
            .expect("failed to install SIGINT handler");
    };

    #[cfg(unix)]
    let terminate = async {
        #[allow(clippy::expect_used)]
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
    info!("shutdown signal received, draining in-flight requests");
}

// PORT STATUS: src/index.ts (health-only boot scaffold)
// confidence: medium
// todos: 1
// notes: CLI subcommands (pair/status), full config load, and auth wiring are
// TODO(port); this binary currently only proves the axum boot/shutdown and
// GET /health wire-parity for Task 1.3.
