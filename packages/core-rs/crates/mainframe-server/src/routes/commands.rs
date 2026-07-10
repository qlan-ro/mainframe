//! Ported from `src/server/routes/commands.ts` — GET /api/commands.
//!
//! Returns the built-in mainframe commands from the services command registry.
//! The TS also appends every registered adapter's `listCommands()`; the ported
//! `Adapter` trait has no `list_commands` method, so that union is blocked in the
//! trait (a non-owned crate) and stays a documented seam.

use std::sync::Arc;

use axum::Router;
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use mainframe_services::commands::get_mainframe_commands;

use crate::ctx::AppCtx;
use crate::respond::ok;

async fn list(State(_ctx): State<Arc<AppCtx>>) -> Response {
    let commands = get_mainframe_commands();
    // TODO(port): the TS appends `adapter.listCommands()` for every registered
    // adapter (`ctx.adapters.getAll()`). The registry is now on AppCtx, but the
    // ported `mainframe_adapter_api::Adapter` trait has no `list_commands` method
    // (only Claude implements it in TS; codex does not), so it cannot be called
    // through `Arc<dyn Adapter>`. Closing this union needs `list_commands` added to
    // the Adapter trait (a non-owned crate) — a blocker. Built-ins only for now.
    ok(commands)
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/commands", get(list))
}

// PORT STATUS: src/server/routes/commands.ts (1 endpoint, 24 lines)
// confidence: medium
// todos: 1
// notes: getMainframeCommands() → mainframe_services::commands::get_mainframe_commands.
// The per-adapter listCommands() union stays a seam: the ported Adapter trait has
// no list_commands method (only Claude implements it in TS), so it can't be called
// through Arc<dyn Adapter>. Adding it to the trait (non-owned crate) is a blocker;
// returned set is the built-in mainframe commands only.
