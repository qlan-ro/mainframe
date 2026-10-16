//! Provider CLI version checks and in-app updates (#405). The update itself
//! runs in the background; progress reaches clients as `provider.cli.updated`.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};

use crate::cli_update::CliUpdateError;
use crate::ctx::AppCtx;
use crate::respond::{fail, ok};

fn error_response(error: CliUpdateError) -> Response {
    let status = match error {
        CliUpdateError::Unsupported | CliUpdateError::NotInstalled => StatusCode::NOT_FOUND,
        CliUpdateError::NotUpdatable => StatusCode::BAD_REQUEST,
        CliUpdateError::Busy => StatusCode::CONFLICT,
    };
    fail(status, error.to_string())
}

async fn list(State(ctx): State<Arc<AppCtx>>) -> Response {
    ok(ctx.services.cli_updates.statuses())
}

async fn check(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    if !mainframe_types::ids::is_safe_identifier(&id) {
        return fail(StatusCode::BAD_REQUEST, "invalid provider id");
    }
    match ctx.services.cli_updates.check(&id, true).await {
        Ok(status) => ok(status),
        Err(error) => error_response(error),
    }
}

async fn update(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    if !mainframe_types::ids::is_safe_identifier(&id) {
        return fail(StatusCode::BAD_REQUEST, "invalid provider id");
    }
    match ctx.services.cli_updates.start_update(&id) {
        Ok(status) => ok(status),
        Err(error) => error_response(error),
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/providers/cli-status", get(list))
        .route("/api/providers/{id}/cli/check", post(check))
        .route("/api/providers/{id}/cli/update", post(update))
}

#[cfg(test)]
#[path = "cli_update_tests.rs"]
mod tests;
