//! Interactions, action catalog, credentials (Node
//! routes/automation-admin.ts). Credential GETs never return secret
//! material; the `^[a-zA-Z0-9_-]+$` label rule keeps the reserved
//! `webhook:<hookId>` labels out of user-facing CRUD (no colon).

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post, put};
use mainframe_automations::interactions::InteractionError;
use mainframe_automations::ports::to_interaction_summary;
use serde::Deserialize;
use serde_json::json;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};
use crate::routes::automations::{engine, engine_error, unavailable};
use crate::routes::projects::parse_body;

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn invalid_label(label: &str) -> Response {
    fail(
        StatusCode::BAD_REQUEST,
        format!("invalid label '{label}': must match ^[a-zA-Z0-9_-]+$"),
    )
}

// ── interactions ────────────────────────────────────────────────────────────

async fn list_interactions(State(ctx): State<Arc<AppCtx>>) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    match engine.list_pending_interactions().await {
        Ok(records) => ok(records
            .iter()
            .map(to_interaction_summary)
            .collect::<Vec<_>>()),
        Err(err) => engine_error(err),
    }
}

#[derive(Deserialize)]
struct RespondBody {
    response: serde_json::Map<String, serde_json::Value>,
}

async fn respond(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>, body: Bytes) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    let Some(parsed): Option<RespondBody> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "body must be { response: object }");
    };
    match engine.respond(&id, parsed.response).await {
        Ok(()) => ok_empty(),
        Err(err @ InteractionError::NotFound(_)) => fail(StatusCode::NOT_FOUND, err.to_string()),
        Err(err @ (InteractionError::AlreadyAnswered | InteractionError::AlreadyCancelled)) => {
            fail(StatusCode::CONFLICT, err.to_string())
        }
        // Field-level validation + store errors → 400 (Node's catch-all).
        Err(err) => fail(StatusCode::BAD_REQUEST, err.to_string()),
    }
}

// ── action catalog ──────────────────────────────────────────────────────────

async fn list_actions(State(ctx): State<Arc<AppCtx>>) -> Response {
    match engine(&ctx) {
        Some(engine) => ok(engine.action_catalog()),
        None => unavailable(),
    }
}

// ── credentials ─────────────────────────────────────────────────────────────

async fn list_credentials(State(ctx): State<Arc<AppCtx>>) -> Response {
    match engine(&ctx) {
        Some(engine) => ok(json!({ "labels": engine.credential_labels().await })),
        None => unavailable(),
    }
}

async fn get_credential(State(ctx): State<Arc<AppCtx>>, Path(label): Path<String>) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    if !valid_label(&label) {
        return invalid_label(&label);
    }
    match engine.credential_kind(&label).await {
        Some(kind) => ok(json!({ "label": label, "kind": kind })),
        None => fail(StatusCode::NOT_FOUND, "credential not found"),
    }
}

#[derive(Deserialize)]
struct CredentialBody {
    token: String,
}

async fn put_credential(
    State(ctx): State<Arc<AppCtx>>,
    Path(label): Path<String>,
    body: Bytes,
) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    if !valid_label(&label) {
        return invalid_label(&label);
    }
    let Some(parsed): Option<CredentialBody> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "body must be { token: string }");
    };
    match engine.set_credential(&label, parsed.token).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            tracing::error!(label, error = %err, "set credential failed");
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to save credential",
            )
        }
    }
}

async fn delete_credential(State(ctx): State<Arc<AppCtx>>, Path(label): Path<String>) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    if !valid_label(&label) {
        return invalid_label(&label);
    }
    match engine.delete_credential(&label).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            tracing::error!(label, error = %err, "delete credential failed");
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to delete credential",
            )
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/automation-interactions", get(list_interactions))
        .route("/api/automation-interactions/{id}/respond", post(respond))
        .route("/api/automation-actions", get(list_actions))
        .route("/api/automation-credentials", get(list_credentials))
        .route(
            "/api/automation-credentials/{label}",
            put(put_credential)
                .get(get_credential)
                .delete(delete_credential),
        )
}

#[cfg(test)]
mod automation_admin_tests;

// PORT STATUS: src/server/routes/automation-admin.ts (7 endpoints, 128 lines)
// confidence: high
// todos: 0
// notes: —
