//! The builtin TODO Kanban plugin: typed rows and request bodies, the
//! versioned schema, the CRUD + move + start-session + attachments HTTP
//! sub-router, and panel/action registration on activate.
//!
//! The sub-router is an axum `Router<Arc<PluginContext>>`; handlers read the
//! capability surfaces off the shared context. `activate` runs migrations,
//! registers the panels/action, and returns the finalized sub-router the
//! manager mounts under `/todos`.

mod attachments;
pub(crate) mod input;
pub(crate) mod migrations;
mod repo;
mod respond;
mod routes;
pub(crate) mod types;

#[cfg(test)]
pub(crate) mod tests;
#[cfg(test)]
mod tests_mutations;
#[cfg(test)]
mod tests_sessions;
#[cfg(test)]
mod tests_support;

use std::sync::Arc;

use axum::Router;
use axum::routing::{get, patch, post};
use mainframe_types::plugin::UiZone;

use crate::PluginError;
use crate::context::PluginContext;

pub(crate) use routes::{delete_todo, move_todo, patch_todo, post_todo};
pub(crate) use types::safe_json_array;

/// The plugin's HTTP sub-router (relative to its `/todos` mount point).
pub fn routes() -> Router<Arc<PluginContext>> {
    Router::new()
        .route("/todos", get(routes::get_todos).post(post_todo))
        .route("/todos/{id}", patch(patch_todo).delete(delete_todo))
        .route("/todos/{id}/move", patch(move_todo))
        .route("/todos/{id}/start-session", post(routes::start_session))
        .route(
            "/todos/{id}/attachments",
            get(attachments::list_attachments).post(attachments::post_attachment),
        )
        .route(
            "/todos/{id}/attachments/{attachmentId}",
            get(attachments::get_attachment).delete(attachments::delete_attachment),
        )
        .nest("/github", crate::todos_github::routes::router())
}

/// `activate(ctx)` — run migrations, register the panels/action, and return the
/// finalized sub-router (the manager mounts it under `/<plugin id>`).
pub async fn activate(ctx: Arc<PluginContext>) -> Result<Router<()>, PluginError> {
    migrations::run(&ctx).await?;

    // Primary fullview: Kanban board.
    let kanban = ctx
        .ui
        .add_panel(UiZone::Fullview, "Tasks", Some("square-check"));
    // Secondary right-top zone: quick-add summary sidebar.
    let sidebar = ctx
        .ui
        .add_panel(UiZone::RightTop, "Tasks Sidebar", Some("list-todo"));
    ctx.ui
        .add_action("quick-create", "New Task", "mod+t", Some("plus"));

    let ui = Arc::clone(&ctx.ui);
    ctx.on_unload(move || {
        ui.remove_panel(Some(&kanban));
        ui.remove_panel(Some(&sidebar));
        ui.remove_action("quick-create");
    });
    tracing::info!("TODO Kanban plugin activated");

    Ok(routes().with_state(ctx))
}
