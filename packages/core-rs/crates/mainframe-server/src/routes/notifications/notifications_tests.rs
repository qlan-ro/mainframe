use axum::body::{Bytes, to_bytes};
use axum::extract::State;
use axum::http::StatusCode;

use super::create;
use crate::ctx::AppCtx;

async fn body_json(resp: axum::response::Response) -> (StatusCode, serde_json::Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn posting_a_notification_broadcasts_and_returns_ok() {
    let ctx = AppCtx::test_ctx();
    let mut rx = ctx.broadcast.subscribe();
    let body = Bytes::from(r#"{"title":"todo 12 lane","body":"pipeline:qa"}"#);

    let (status, json) = body_json(create(State(ctx), body).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json, serde_json::json!({ "success": true }));

    match rx.recv().await.unwrap() {
        mainframe_types::events::DaemonEvent::NotificationCreated { title, body, links } => {
            assert_eq!(title, "todo 12 lane");
            assert_eq!(body, "pipeline:qa");
            assert!(links.is_none());
        }
        other => panic!("unexpected event: {other:?}"),
    }
}

#[tokio::test]
async fn rejects_an_empty_title() {
    let ctx = AppCtx::test_ctx();
    let body = Bytes::from(r#"{"title":"   ","body":"pipeline:qa"}"#);

    let (status, json) = body_json(create(State(ctx), body).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["success"], serde_json::json!(false));
}

/// `PushService::send_push` has no `Result` — a push with nothing to deliver
/// to (no registered devices, the case here) is structurally indistinguishable
/// from a failed one at this layer, and either way the request still succeeds.
#[tokio::test]
async fn a_push_that_reaches_no_device_still_returns_success() {
    let ctx = AppCtx::test_ctx();
    assert!(!ctx.services.push.has_registered_devices());
    let body = Bytes::from(r#"{"title":"todo 12 lane","body":"pipeline:qa"}"#);

    let (status, json) = body_json(create(State(ctx), body).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json, serde_json::json!({ "success": true }));
}
