//! Automations v2 CRUD + runs routes (contract §4; Node
//! routes/automations.ts): WS4 envelope, 202 on a started manual run,
//! timeline projection with 32 KB output-preview truncation.

use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use mainframe_automations::domain::AutomationCreateInput;
use mainframe_automations::ports::to_run_summary;
use mainframe_automations::store::RunRecord;
use mainframe_automations::{AutomationsEngine, EngineError};
use mainframe_types::automation::AutomationTimelineEntry;
use serde::Deserialize;
use serde_json::json;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};
use crate::routes::projects::parse_body;

const OUTPUT_PREVIEW_MAX_BYTES: usize = 32 * 1024;

/// Every handler self-gates on the engine (Node: `if (!service) 503`).
pub(crate) fn engine(ctx: &AppCtx) -> Option<&Arc<AutomationsEngine>> {
    ctx.automations.as_ref()
}

pub(crate) fn unavailable() -> Response {
    fail(
        StatusCode::SERVICE_UNAVAILABLE,
        "automation service not available",
    )
}

/// EngineError → WS4 envelope. Validation carries the structured
/// `errors: [{stepId, message}]` array beside the standard envelope.
pub(crate) fn engine_error(err: EngineError) -> Response {
    use mainframe_automations::error::StoreError;
    match err {
        EngineError::Validation { errors } => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "error": errors.iter().map(|e| e.message.clone()).collect::<Vec<_>>().join("; "),
                "errors": errors,
            })),
        )
            .into_response(),
        EngineError::Store(StoreError::NotFound { kind, .. }) => {
            let what = if kind == "automation run" {
                "run"
            } else {
                kind
            };
            fail(StatusCode::NOT_FOUND, format!("{what} not found"))
        }
        EngineError::Store(err) => fail(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
    }
}

async fn list(State(ctx): State<Arc<AppCtx>>) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    match engine.list().await {
        Ok(list) => ok(list),
        Err(err) => engine_error(err),
    }
}

async fn create(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    let Some(input): Option<AutomationCreateInput> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "invalid automation body");
    };
    match engine.create(input).await {
        Ok(summary) => ok(summary),
        Err(err) => engine_error(err),
    }
}

async fn get_one(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    match engine.get(&id).await {
        Ok(Some(summary)) => ok(summary),
        Ok(None) => fail(StatusCode::NOT_FOUND, "automation not found"),
        Err(err) => engine_error(err),
    }
}

async fn update(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>, body: Bytes) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    let Some(input): Option<AutomationCreateInput> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "invalid automation body");
    };
    match engine.update(&id, input).await {
        Ok(summary) => ok(summary),
        Err(err) => engine_error(err),
    }
}

async fn remove(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    match engine.delete(&id).await {
        Ok(()) => ok_empty(),
        Err(err) => engine_error(err),
    }
}

#[derive(Deserialize)]
struct EnabledBody {
    enabled: bool,
}

/// A4 — the library toggle's route.
async fn set_enabled(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    let Some(parsed): Option<EnabledBody> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "body must be { enabled: boolean }");
    };
    match engine.set_enabled(&id, parsed.enabled).await {
        Ok(summary) => ok(summary),
        Err(err) => engine_error(err),
    }
}

/// 202 — the run started; progress streams over `automation.run.updated`.
async fn run_manually(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    match engine.run_manually(&id).await {
        Ok(run) => (
            StatusCode::ACCEPTED,
            Json(json!({ "success": true, "data": to_run_summary(&run) })),
        )
            .into_response(),
        Err(err) => engine_error(err),
    }
}

async fn list_runs(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    match engine.list_runs(&id).await {
        Ok(runs) => ok(runs),
        Err(err) => engine_error(err),
    }
}

async fn get_run(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    match engine.get_run(&id).await {
        Ok(Some(run)) => ok(json!({
            "run": to_run_summary(&run),
            "timeline": project_timeline(&run),
        })),
        Ok(None) => fail(StatusCode::NOT_FOUND, "run not found"),
        Err(err) => engine_error(err),
    }
}

async fn cancel_run(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    match engine.cancel_run(&id).await {
        Ok(()) => ok_empty(),
        Err(err) => engine_error(err),
    }
}

/// Timeline projection (contract §4: 32 KB display truncation).
fn project_timeline(run: &RunRecord) -> Vec<AutomationTimelineEntry> {
    run.checkpoint
        .steps
        .iter()
        .map(|(step_ref, entry)| AutomationTimelineEntry {
            step_ref: step_ref.clone(),
            step_id: entry.step_id.clone(),
            kind: entry.kind.clone(),
            status: entry.status,
            output_preview: output_preview(entry.outputs.as_ref()),
            error: entry.error.clone(),
            chat_id: entry.chat_id.clone(),
            interaction_id: entry.interaction_id.clone(),
            started_at: entry.started_at,
            finished_at: entry.finished_at,
        })
        .collect()
}

/// Node routes/automations.ts outputPreview: whole-JSON preview or a loud
/// truncation marker — never a partial JSON document.
fn output_preview(outputs: Option<&serde_json::Map<String, serde_json::Value>>) -> Option<String> {
    let outputs = outputs?;
    let rendered = serde_json::Value::Object(outputs.clone()).to_string();
    if rendered.len() <= OUTPUT_PREVIEW_MAX_BYTES {
        Some(rendered)
    } else {
        Some(format!("[truncated — {} bytes]", rendered.len()))
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/automations", get(list).post(create))
        .route(
            "/api/automations/{id}",
            get(get_one).put(update).delete(remove),
        )
        .route("/api/automations/{id}/enabled", patch(set_enabled))
        .route(
            "/api/automations/{id}/runs",
            post(run_manually).get(list_runs),
        )
        .route("/api/automation-runs/{id}", get(get_run))
        .route("/api/automation-runs/{id}/cancel", post(cancel_run))
}

#[cfg(test)]
mod automations_tests;

// PORT STATUS: src/server/routes/automations.ts (9 endpoints, 177 lines)
// confidence: high
// todos: 0
// notes: unused `delete`/`put` route fns are used via the builder chain; the
//        timeline `error` stays `T | null` (Node parity), other optionals omit.
