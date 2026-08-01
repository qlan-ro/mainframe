//! The todos-plugin GitHub sub-router (todo #286, task 19): raw-JSON handlers
//! (no `ok`/`fail` envelope — that convention is the daemon's own routes, not
//! this plugin's, per the frozen wire contract) mounted under `/github` by
//! `todos::routes()`.

pub mod link;
pub mod pairs;
pub mod sync;

use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use serde_json::{Value, json};

use crate::PluginContext;
use crate::PluginError;
use crate::github_port::GitHubPortError;
use crate::todos_github::store;

pub fn router() -> Router<Arc<PluginContext>> {
    Router::new()
        .route(
            "/link",
            get(link::get_link)
                .put(link::put_link)
                .delete(link::delete_link),
        )
        .route("/pairs", get(pairs::get_pairs))
        .route("/pairs/{todoId}", delete(pairs::delete_pair))
        .route("/issues", get(pairs::get_issues))
        .route("/import", post(pairs::post_import))
        .route("/publish", post(pairs::post_publish))
        .route("/sync", post(sync::post_sync))
        .route("/report", get(sync::get_report))
}

// ─── Response helpers (mirrors todos.rs's, private to this crate's HTTP layer) ─

pub(super) fn json_response(status: StatusCode, body: Value) -> Response {
    (status, axum::Json(body)).into_response()
}

pub(super) fn bad_request(error: &str) -> Response {
    json_response(StatusCode::BAD_REQUEST, json!({ "error": error }))
}

pub(super) fn not_found(error: &str) -> Response {
    json_response(StatusCode::NOT_FOUND, json!({ "error": error }))
}

pub(super) fn conflict(error: &str) -> Response {
    json_response(StatusCode::CONFLICT, json!({ "error": error }))
}

pub(super) fn server_error(err: PluginError) -> Response {
    tracing::error!(err = %err, "todos_github: database error");
    json_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": "Internal error" }),
    )
}

/// The local integration isn't ready to talk to GitHub at all (no stored
/// credential, or a guard-rejected capability) — not a bug, so it's logged
/// at `warn`, not `error`, and the message is the caller-readable one from
/// `GitHubPortError`, not a generic string.
fn service_unavailable(err: &GitHubPortError) -> Response {
    tracing::warn!(err = %err, "todos_github: GitHub integration unavailable");
    json_response(
        StatusCode::SERVICE_UNAVAILABLE,
        json!({ "error": err.to_string() }),
    )
}

/// A live call to GitHub itself failed (bad response, rate limit, network) —
/// this server is correctly configured but the upstream interaction didn't
/// go through.
fn bad_gateway(err: &GitHubPortError) -> Response {
    tracing::warn!(err = %err, "todos_github: GitHub request failed");
    json_response(StatusCode::BAD_GATEWAY, json!({ "error": err.to_string() }))
}

// ─── Request parsing ─────────────────────────────────────────────────────────

// `Response` dwarfs the `Ok` payload, but every caller immediately returns
// this `Err` as-is, so building a smaller error type here would just move
// the conversion to each call site.
#[allow(clippy::result_large_err)]
pub(super) fn require_project_id(params: &HashMap<String, String>) -> Result<String, Response> {
    match params.get("projectId").map(|s| s.trim()) {
        Some(s) if !s.is_empty() => Ok(s.to_string()),
        _ => Err(bad_request("projectId required")),
    }
}

pub(super) fn as_non_empty_string(body: &Value, key: &str) -> Option<String> {
    body.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

// ─── Shared error mapping ────────────────────────────────────────────────────

pub(super) fn pairing_error_response(err: crate::todos_github::pairing::PairingError) -> Response {
    use crate::todos_github::pairing::PairingError;
    match err {
        PairingError::NotLinked => not_found("GitHub sync is not linked for this project."),
        PairingError::TodoNotFound => not_found("Task not found."),
        PairingError::AlreadyPaired => conflict("This task is already paired with a GitHub issue."),
        PairingError::Port(err) => port_error_response(&err),
        PairingError::Failed(err) => server_error(err),
    }
}

/// Mirrors `run/mod.rs`'s `handle_port_error` classification, adapted to a
/// direct request/response instead of a stored run: `NotFound`/`Moved` name
/// a resource that no longer exists at the paired location, the rest are
/// this project's GitHub integration failing to reach or authenticate with
/// GitHub itself.
fn port_error_response(err: &GitHubPortError) -> Response {
    match err {
        GitHubPortError::NotFound | GitHubPortError::Moved => not_found(&err.to_string()),
        GitHubPortError::Auth(_) | GitHubPortError::Unavailable(_) => service_unavailable(err),
        GitHubPortError::RateLimited { .. }
        | GitHubPortError::Network(_)
        | GitHubPortError::Request { .. } => bad_gateway(err),
    }
}

// ─── Shared serialization ────────────────────────────────────────────────────

pub(super) fn link_json(link: &store::Link) -> Value {
    json!({
        "projectId": link.project_id,
        "owner": link.owner,
        "repo": link.repo,
        "remoteName": link.remote_name,
        "credentialLabel": link.credential_label,
        "lastSyncedAt": link.last_synced_at,
    })
}

/// The daemon is the sole owner of the reserved-label denylist
/// (`todos_github::labels`) — the UI takes it as data on `GET /link` instead
/// of restating the prefixes/labels, so the publish dialog's preview can
/// never drift from what a sync run actually withholds.
pub(super) fn workflow_labels_json() -> Value {
    json!({
        "prefixes": crate::todos_github::labels::WORKFLOW_LABEL_PREFIXES,
        "labels": crate::todos_github::labels::WORKFLOW_LABELS,
    })
}

/// The fields a `Pair` needs on the wire, gathered from wherever the caller
/// already has them (a store row plus a separately queried `todos.number`).
pub(super) struct PairFields<'a> {
    pub todo_id: &'a str,
    pub todo_number: i64,
    pub issue_number: i64,
    pub issue_url: &'a str,
    pub pair_state: &'a str,
    pub state_reason: Option<&'a str>,
}

pub(super) fn pair_json(p: PairFields) -> Value {
    json!({
        "todoId": p.todo_id,
        "todoNumber": p.todo_number,
        "issueNumber": p.issue_number,
        "issueUrl": p.issue_url,
        "pairState": p.pair_state,
        "stateReason": p.state_reason,
    })
}

/// Reconcile's internal winner is `"local"`/`"github"` (it never names the
/// product) — the frozen wire union is `'github'|'mainframe'`.
pub(super) fn map_winner(winner: &str) -> &'static str {
    if winner == "local" {
        "mainframe"
    } else {
        "github"
    }
}
