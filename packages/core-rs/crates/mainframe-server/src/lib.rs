//! Ported from `src/server/*` (packages/core) — the axum HTTP app, the WebSocket
//! layer, the response envelope, and path validation.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod async_err;
pub mod chat_deps;
pub mod chat_seams;
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

pub use chat_deps::build_chat_manager;
pub use chat_seams::{LaunchStopper, RegistryLaunchStopper, default_launch_stopper};
pub use ctx::{AppCtx, GitFactory, Services};
pub use db::Db;
pub use http::build_app;
pub use websocket::{WsClients, spawn_broadcast_pump};

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
