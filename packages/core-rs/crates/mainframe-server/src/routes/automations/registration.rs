//! T7 — webhook registration. The URL is composed here rather than in the
//! engine because only the server knows the port it is listening on, and it
//! is deliberately `127.0.0.1`: the daemon has no public tunnel, so the hook
//! is reachable only from this machine.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use mainframe_automations::domain::{Trigger, WebhookRegistration};
use mainframe_automations::{AutomationSummary, AutomationsEngine, EngineError, WebhookState};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};

use super::{engine, engine_error, unavailable};

pub(super) async fn register(
    State(ctx): State<Arc<AppCtx>>,
    Path((id, trigger_id)): Path<(String, String)>,
) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    match engine.arm_webhook(&id, &trigger_id).await {
        Ok(Some(state)) => ok(to_wire(&state, ctx.port)),
        Ok(None) => fail(
            StatusCode::NOT_FOUND,
            "automation or webhook trigger not found",
        ),
        Err(err) => engine_error(err),
    }
}

/// Reads an automation with the server-computed registration hung off every
/// armed webhook trigger.
pub(super) async fn get_with_registrations(
    engine: &AutomationsEngine,
    id: &str,
    port: u16,
) -> Result<Option<AutomationSummary>, EngineError> {
    let Some(mut summary) = engine.get(id).await? else {
        return Ok(None);
    };
    for trigger in &mut summary.definition.triggers {
        let Trigger::Webhook(hook) = trigger else {
            continue;
        };
        hook.registration = engine
            .webhook_state(&hook.hook_id)
            .await?
            .map(|state| to_wire(&state, port));
    }
    Ok(Some(summary))
}

fn to_wire(state: &WebhookState, port: u16) -> WebhookRegistration {
    WebhookRegistration {
        hook_id: state.hook_id.clone(),
        url: format!(
            "http://127.0.0.1:{port}/api/automation-webhooks/{}",
            state.hook_id
        ),
        last_delivery_at: state.last_delivery_at.clone(),
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-25-todo-234-automations-editor-plan.md T7), not a TS port
// confidence: high
// todos: 0
// notes: only the single-automation GET embeds registrations; the list route
//        would pay a store read per webhook trigger for a column the library
//        never renders.
