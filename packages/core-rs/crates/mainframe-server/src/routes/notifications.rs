//! `POST /api/notifications` — a standalone, run-less notification: any
//! loopback caller (contract middleware/auth.rs — loopback is never
//! rejected) can raise one with no token. `lane_apply.py` is the first
//! caller: the todo-lane pipeline runs as a Claude CLI session (no
//! `PushNotification` harness tool), so this route is its only way to
//! surface a stage update natively.
//!
//! Broadcasts `notification.created` on the WS bus and mirrors it to mobile
//! push, sharing `broadcast_and_push` with `DaemonNotifier` so the two
//! "tell the user" paths don't duplicate the send.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use mainframe_services::push::{PushMessage, PushPriority};
use mainframe_types::events::{DaemonEvent, NotificationLinks};
use serde::Deserialize;

use crate::automations_deps::broadcast_and_push;
use crate::ctx::AppCtx;
use crate::respond::{fail, ok_empty};
use crate::routes::projects::parse_body;

#[derive(Deserialize)]
struct NotifyBody {
    title: String,
    #[serde(default)]
    body: String,
    links: Option<NotifyLinksBody>,
}

#[derive(Deserialize)]
struct NotifyLinksBody {
    #[serde(default)]
    chat_ids: Vec<String>,
}

async fn create(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(parsed): Option<NotifyBody> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    if parsed.title.trim().is_empty() {
        return fail(StatusCode::BAD_REQUEST, "title is required");
    }

    let event = DaemonEvent::NotificationCreated {
        title: parsed.title.clone(),
        body: parsed.body.clone(),
        links: parsed.links.map(|links| NotificationLinks {
            chat_ids: links.chat_ids,
        }),
    };
    let message = PushMessage {
        title: parsed.title,
        body: parsed.body,
        data: serde_json::json!({}),
        priority: PushPriority::Default,
    };
    broadcast_and_push(&ctx.broadcast, &ctx.services.push, event, message).await;
    ok_empty()
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/notifications", post(create))
}

#[cfg(test)]
mod notifications_tests;
