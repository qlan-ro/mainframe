//! Ported from `src/index.ts`, `src/cli/*` (packages/core).
//!
//! Phase-3 boot: config → auth secret → DB (actor handle) → services → broadcast
//! → HTTP/WS server, with graceful SIGINT/SIGTERM shutdown. The Phase-4/5 boot
//! steps (registries, ChatManager, plugins, background reconcile, tunnel) and the
//! CLI subcommands (`pair`/`status`/`update`) are TODO(port).
#![forbid(unsafe_code)]

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use mainframe_server::ctx::{AppCtx, GitFactory, Services};
use mainframe_server::db::Db;
use mainframe_server::{build_app, spawn_broadcast_pump};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_types::events::DaemonEvent;
use tokio::signal;
use tracing::info;

const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Fan-out channel depth. Slow WS clients that lag past this are warned and
/// resynced on their next event (see websocket::spawn_broadcast_pump).
const BROADCAST_CAPACITY: usize = 1024;

#[tokio::main]
async fn main() {
    let _log_guard = mainframe_runtime::logging::init();

    let config = match mainframe_runtime::config::get_config() {
        Ok(config) => config,
        Err(err) => fatal("failed to load config", &err),
    };
    // ensureAuthSecret(): generates + persists a secret if none exists. The TS
    // daemon then sets process.env.AUTH_TOKEN_SECRET; env mutation is `unsafe`
    // under edition 2024, so the secret is threaded through AppCtx instead.
    let auth_secret = match mainframe_runtime::config::ensure_auth_secret() {
        Ok(secret) => Some(secret),
        Err(err) => fatal("failed to resolve auth secret", &err),
    };
    let data_dir = PathBuf::from(&config.data_dir);
    let port = config.port;
    info!(data_dir = %data_dir.display(), "data directory");

    let db = match Db::spawn(mainframe_db::DatabaseManager::new) {
        Ok(db) => db,
        Err(err) => fatal("failed to open database", &err),
    };

    let (broadcast, _keepalive_rx) =
        tokio::sync::broadcast::channel::<DaemonEvent>(BROADCAST_CAPACITY);

    // File-change events are broadcast like any other daemon event.
    let watcher_tx = broadcast.clone();
    let watcher = FileWatcherService::new(move |event| {
        let _ = watcher_tx.send(event);
    });

    let services = Services {
        attachments: Arc::new(AttachmentStore::new(data_dir.join("attachments"))),
        push: Arc::new(PushService::new()),
        watcher: Arc::new(watcher),
    };

    let ctx = Arc::new(AppCtx {
        db,
        git: GitFactory,
        services,
        broadcast,
        data_dir,
        version: DAEMON_VERSION.to_string(),
        auth_secret,
        tunnel_url: None,
        ws_clients: Arc::new(dashmap::DashMap::new()),
    });

    spawn_broadcast_pump(Arc::clone(&ctx));

    let app = build_app(Arc::clone(&ctx));

    // Loopback only — matches `httpServer.listen(port, '127.0.0.1')` in index.ts.
    // Binding all interfaces would expose the daemon on every NIC/LAN, and with
    // `AUTH_TOKEN_SECRET` unset the auth gate is a no-op. Only loopback and the
    // local cloudflared tunnel may reach the daemon.
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) => fatal("failed to bind daemon listener", &err),
    };
    info!(%addr, version = DAEMON_VERSION, "mainframe-daemon listening");

    let service = app.into_make_service_with_connect_info::<SocketAddr>();
    if let Err(err) = axum::serve(listener, service)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        tracing::error!(%err, "daemon server exited with error");
        std::process::exit(1);
    }
}

/// Log a fatal boot error and exit. Boot failures have no supervisor to hand a
/// `Result` back to — the RUST RULES permit the abort only here, in `main`.
fn fatal(context: &str, err: &dyn std::fmt::Display) -> ! {
    tracing::error!(error = %err, "{context}");
    std::process::exit(1);
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

// PORT STATUS: src/index.ts (Phase-3 boot: config → auth → DB → services → server)
// confidence: medium
// todos: 1
// notes: Boots the real AppCtx (Db actor handle, AttachmentStore/PushService/
// FileWatcherService, broadcast channel, WS client registry) and serves the full
// app + WS with graceful shutdown. `AUTH_TOKEN_SECRET` is threaded via AppCtx
// (no env mutation — `set_var` is unsafe under edition 2024). TODO(port):
// registries, ChatManager, plugins, background reconcile, tunnel, and the CLI
// subcommands (pair/status/update) land in Phase 4/5. `_keepalive_rx` holds a
// receiver so the broadcast channel never reports Closed before the pump task
// subscribes; the pump owns the authoritative receiver.
