//! Ported from `src/server/*` (packages/core) — the axum HTTP app, the WebSocket
//! layer, the response envelope, and path validation.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod async_err;
pub mod automations_deps;
pub mod chat_deps;
pub mod chat_seams;
pub mod cors_origin;
pub mod ctx;
pub mod db;
pub mod fs_utils;
pub mod http;
pub mod middleware;
pub mod net;
pub mod path_utils;
pub mod respond;
pub mod ripgrep;
pub mod routes;
pub mod websocket;
pub mod ws_file_watch;
pub mod ws_schemas;

pub use automations_deps::build_automations_engine;
pub use chat_deps::build_chat_manager;
pub use chat_seams::{LaunchStopper, RegistryLaunchStopper, default_launch_stopper};
pub use ctx::{AppCtx, GitFactory, Services};
pub use db::Db;
pub use http::build_app;
pub use websocket::{WsClients, spawn_broadcast_pump};

use std::net::SocketAddr;

use axum::Router;
use tokio::net::TcpListener;

/// Bind the daemon's HTTP listener and serve the app. Ported from
/// `ServerManager.start` in `src/server/index.ts`.
///
/// The bind runs first: a bind failure (`EADDRINUSE` from a duplicate/stale
/// daemon) is returned as an `Err` for the caller to reject on — never an
/// unhandled `error` event that silently kills the process (the TS
/// `httpServer.once('error', onBindError)` → `reject(err)`). Once listening,
/// `axum::serve` runs; a later serve error is returned for the caller to log,
/// mirroring the post-listen `httpServer.on('error', …)` late error handler.
pub async fn start(app: Router, addr: SocketAddr) -> std::io::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    let service = app.into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, service).await
}

#[cfg(test)]
mod start_tests {
    use super::*;

    // Mirrors server-start-error.test.ts: a bind onto an already-bound port must
    // reject with EADDRINUSE, not crash the process.
    #[tokio::test]
    async fn start_rejects_when_the_port_is_already_bound() {
        let blocker = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .unwrap();
        let addr = blocker.local_addr().unwrap();

        let err = start(Router::new(), addr).await.unwrap_err();

        assert_eq!(err.kind(), std::io::ErrorKind::AddrInUse);
        drop(blocker);
    }
}

// PORT STATUS: src/server/* (Phase 3 — server core, WS, envelope, path utils)
// confidence: medium
// todos: 1
// notes: Task 3.1 lands http.rs, websocket.rs, respond.rs, path_utils.rs,
// async_err.rs, the auth middleware, ws_schemas, ws_file_watch, the AppCtx + Db
// actor handle, and the 12 EMPTY route stubs (filled by the route agents). The
// route bodies, plugin router mount, LSP upgrade route, and the chat WS handlers
// (message.send / permission.respond) are Phase 4/5 seams (see per-file PORT
// STATUS). fs-utils.ts, ripgrep.ts, adapter-replay.ts, suggestions/, and
// routes/schemas.ts|types.ts land with their consuming route agents.
