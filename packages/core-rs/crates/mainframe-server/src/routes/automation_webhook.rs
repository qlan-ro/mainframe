//! `POST /api/automation-webhooks/:hookId` — auth-exempt by path
//! (middleware/auth.rs). HMAC is computed over the exact request bytes, so
//! the handler takes `Bytes`, never a parsed JSON extractor. Status mapping
//! is A7: duplicate 200 no-op, preset non-match / stale 204, start failure
//! 500 (the sender retries).

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use mainframe_automations::triggers::{WebhookDecision, WebhookHeaders};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok_empty};
use crate::routes::automations::{engine, unavailable};

fn header(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

async fn ingest(
    State(ctx): State<Arc<AppCtx>>,
    Path(hook_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(engine) = engine(&ctx) else {
        return unavailable();
    };
    let webhook_headers = WebhookHeaders {
        signature: header(&headers, "x-hub-signature-256")
            .or_else(|| header(&headers, "x-signature")),
        github_event: header(&headers, "x-github-event"),
        github_delivery: header(&headers, "x-github-delivery"),
        timestamp: header(&headers, "x-timestamp"),
    };
    match engine
        .process_webhook(&hook_id, &webhook_headers, &body)
        .await
    {
        WebhookDecision::UnknownHook => fail(StatusCode::NOT_FOUND, "unknown webhook"),
        WebhookDecision::InvalidSignature => fail(StatusCode::UNAUTHORIZED, "invalid signature"),
        WebhookDecision::InvalidJson => fail(StatusCode::BAD_REQUEST, "invalid JSON payload"),
        WebhookDecision::MissingDeliveryId => fail(
            StatusCode::BAD_REQUEST,
            "webhook delivery missing a delivery id (X-GitHub-Delivery header or payload.id)",
        ),
        WebhookDecision::PresetMismatch | WebhookDecision::StaleDelivery => {
            StatusCode::NO_CONTENT.into_response()
        }
        WebhookDecision::Duplicate | WebhookDecision::Accepted { .. } => ok_empty(),
        WebhookDecision::StartFailed { error } => {
            tracing::error!(hook_id, error, "webhook delivery failed to start a run");
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to start automation run",
            )
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/automation-webhooks/{hookId}", post(ingest))
}

#[cfg(test)]
mod automation_webhook_tests;

// PORT STATUS: src/server/routes/automation-webhook.ts (124 lines)
// confidence: high
// todos: 0
// notes: decision→status table mirrors triggers/webhook_ingest.rs's module
//        doc exactly; the ingest pipeline itself is engine-side (T8.3).
