//! The plugin's JSON response envelopes; the error texts are part of the wire
//! contract the Kanban UI matches on.

use axum::extract::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use crate::PluginError;

pub(super) fn json_response(status: StatusCode, body: Value) -> Response {
    (status, Json(body)).into_response()
}

pub(super) fn bad_request(error: &str) -> Response {
    json_response(StatusCode::BAD_REQUEST, json!({ "error": error }))
}

pub(super) fn not_found() -> Response {
    json_response(StatusCode::NOT_FOUND, json!({ "error": "Not found" }))
}

pub(super) fn server_error(err: PluginError) -> Response {
    tracing::error!(err = %err, "todos: database error");
    json_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": "Internal error" }),
    )
}
