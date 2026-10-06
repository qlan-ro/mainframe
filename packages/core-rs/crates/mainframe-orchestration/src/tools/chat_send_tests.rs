use mainframe_types::chat::ChatStatus;
use mainframe_types::settings::ExecutionMode;
use serde_json::json;

use super::*;
use crate::input::golden::{fixture_keys, schema_properties};
use crate::ports::PendingPermissionView;
use crate::test_support::{FakePort, service_with};

fn setup(
    target: impl FnOnce(&mut ChatView),
) -> (std::sync::Arc<OrchestrationService>, CallCtx, FakePort) {
    let port = FakePort::new();
    let mut caller = port.add_chat("caller");
    caller.working = true;
    port.put(caller);
    let mut chat = port.add_chat("target");
    target(&mut chat);
    port.put(chat);
    let (svc, ctx) = service_with(port.clone(), "caller");
    (svc, ctx, port)
}

async fn send(
    mode: &str,
    target: impl FnOnce(&mut ChatView),
) -> (Result<Value, ToolError>, FakePort) {
    let (svc, ctx, port) = setup(target);
    let args = json!({ "chatId": "target", "message": "hi", "mode": mode });
    (run(&svc, &ctx, args).await, port)
}

fn code(result: &Result<Value, ToolError>) -> Option<ErrorCode> {
    result.as_ref().err().map(|e| e.code)
}

#[test]
fn schema_matches_the_input_struct() {
    let accept = json!({ "chatId": "c", "message": "m", "mode": "queue" });
    assert_eq!(
        schema_properties(&definition().input_schema),
        fixture_keys(&accept)
    );
    assert!(parse_args::<Input>(accept).is_ok());
    assert!(parse_args::<Input>(json!({ "chatId": "c" })).is_err());
    assert!(parse_args::<Input>(json!({ "chatId": "c", "message": "" })).is_err());
    assert!(parse_args::<Input>(json!({ "chatId": "c", "message": "m", "mode": "now" })).is_err());
}

#[tokio::test]
async fn idle_targets_start_now_except_for_steer() {
    for mode in ["auto", "queue"] {
        let (result, port) = send(mode, |_| {}).await;
        assert_eq!(result.unwrap()["delivery"], "started");
        let body = &port.lock().sent[0].1;
        assert!(body.contains("kind=\"send\""));
    }
    let (result, _) = send("steer", |_| {}).await;
    assert_eq!(code(&result), Some(ErrorCode::NoActiveTurn));
}

#[tokio::test]
async fn busy_targets_queue_in_the_outbox_or_steer() {
    for mode in ["auto", "queue"] {
        let (result, port) = send(mode, |c| c.working = true).await;
        let out = result.unwrap();
        assert_eq!(out["delivery"], "queued");
        assert!(out["outboxEntryId"].is_string());
        assert!(port.lock().sent.is_empty());
    }
    let gated = |c: &mut ChatView| {
        c.pending_permission = Some(PendingPermissionView {
            tool_name: "Bash".into(),
            summary: String::new(),
        });
    };
    let (result, _) = send("auto", gated).await;
    assert_eq!(result.unwrap()["delivery"], "queued");
    let (result, port) = send("steer", |c| c.working = true).await;
    assert_eq!(result.unwrap()["delivery"], "steered");
    assert_eq!(port.lock().steered.len(), 1);
}

#[tokio::test]
async fn steer_on_an_adapter_without_steer_is_refused() {
    let (svc, ctx, port) = setup(|c| c.working = true);
    port.lock().adapters[0].steer = false;
    let args = json!({ "chatId": "target", "message": "hi", "mode": "steer" });
    let result = run(&svc, &ctx, args).await;
    assert_eq!(code(&result), Some(ErrorCode::NotSteerable));
}

#[tokio::test]
async fn ended_archived_side_and_escalated_targets_are_refused() {
    for status in [ChatStatus::Ended, ChatStatus::Archived] {
        let (result, _) = send("auto", |c| c.status = status).await;
        assert_eq!(code(&result), Some(ErrorCode::ChatNotSendable));
    }
    let (result, _) = send("auto", |c| c.temporary = true).await;
    assert_eq!(code(&result), Some(ErrorCode::ChatNotSendable));
    let (result, _) = send("auto", |c| c.permission_mode = ExecutionMode::Yolo).await;
    assert_eq!(
        code(&result),
        Some(ErrorCode::PermissionModeEscalationDenied)
    );
    let (svc, ctx, _) = setup(|_| {});
    let result = run(&svc, &ctx, json!({ "chatId": "ghost", "message": "hi" })).await;
    assert_eq!(code(&result), Some(ErrorCode::ChatNotFound));
}
