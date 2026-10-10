//! The axum HTTP app, the WebSocket layer, the response envelope, and path
//! validation.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
// A route helper that fails returns the `Response` it wants sent — that IS the
// error here, and `respond.rs`'s `fail`/`ok` pair is built around it. Boxing it
// to satisfy `result_large_err` would put an allocation on every error path to
// silence a lint about a type axum hands us. The toolchain is unpinned
// (`rust-toolchain.toml` tracks `stable`), so this fires whenever clippy lowers
// the threshold rather than when the code changes.
#![allow(clippy::result_large_err)]

pub mod acp_ws;
pub mod async_err;
pub mod automations_deps;
pub mod chat_deps;
pub mod chat_seams;
#[cfg(test)]
pub(crate) mod chat_test_support;
pub mod cors_origin;
pub mod ctx;
pub mod db;
pub mod fs_utils;
pub mod http;
pub mod middleware;
pub mod net;
pub mod orchestration_deps;
pub mod path_utils;
pub mod respond;
pub mod ripgrep;
pub mod routes;
mod session_kill_bridge;
pub mod setup_advisor;
pub mod skills_cli;
pub mod suggestions;
pub mod websocket;
pub mod ws_file_watch;
pub mod ws_schemas;

pub use acp_ws::FacadeHub;
pub use automations_deps::build_automations_engine;
pub use chat_deps::build_chat_manager;
pub use chat_seams::{
    LaunchStopper, NoopScopeTunnelStopper, RegistryLaunchStopper, RegistryScopeTunnelStopper,
    ScopeTunnelStopper,
};
pub use ctx::{AppCtx, GitFactory, Services};
pub use db::Db;
pub use http::{BODY_LIMIT_BYTES, build_app};
pub use orchestration_deps::build_orchestration;
pub use websocket::{WsClients, spawn_broadcast_pump};

use std::net::SocketAddr;

use axum::Router;
use tokio::net::TcpListener;

/// Bind the daemon's HTTP listener and serve the app.
///
/// The bind runs first: a bind failure (`EADDRINUSE` from a duplicate/stale
/// daemon) is returned as an `Err` for the caller to reject on — never a
/// failure that silently kills the process. Once listening, `axum::serve` runs;
/// a later serve error is returned for the caller to log.
pub async fn start(app: Router, addr: SocketAddr) -> std::io::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    let service = app.into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, service).await
}

#[cfg(test)]
mod start_tests {
    use super::*;

    // A bind onto an already-bound port must reject with EADDRINUSE, not crash
    // the process.
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
