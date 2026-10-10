//! `GET /api/commands`.
//!
//! Returns the built-in mainframe commands from the services command registry.
//! Adapter commands are not appended: the `Adapter` trait has no `list_commands`
//! method, so that union stays a documented seam.

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
    // TODO: append every registered adapter's commands. The registry is on
    // AppCtx, but the `mainframe_adapter_api::Adapter` trait has no
    // `list_commands` method, so they cannot be read through `Arc<dyn Adapter>`.
    // Closing this union needs `list_commands` added to the Adapter trait.
    // Built-ins only for now.
    ok(commands)
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/commands", get(list))
}
