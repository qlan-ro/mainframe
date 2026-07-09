//! Ported from `src/server/routes/commands.ts` — GET /api/commands.
//!
//! Returns the built-in mainframe commands from the services command registry.
//! The TS also appends every registered adapter's `listCommands()`; the adapter
//! registry is Phase 4/5 (not on `AppCtx`), so that union is a documented seam.

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
    // TODO(port-phase4/5): the TS appends `adapter.listCommands()` for every
    // registered adapter (`ctx.adapters.getAll()`). AdapterRegistry is Phase 4/5
    // and not on AppCtx yet, so only the built-in mainframe commands are returned
    // here. See blockers.
    ok(commands)
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/commands", get(list))
}

// PORT STATUS: src/server/routes/commands.ts (1 endpoint, 24 lines)
// confidence: medium
// todos: 1
// notes: getMainframeCommands() → mainframe_services::commands::get_mainframe_commands.
// The per-adapter listCommands() union is a Phase-4/5 seam (AdapterRegistry absent
// from AppCtx); returned set is the built-in mainframe commands only.
