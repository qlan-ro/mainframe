use serde_json::json;

use super::*;
use crate::input::golden::{fixture_keys, schema_properties};
use crate::ports::PendingPermissionView;
use crate::test_support::{FakePort, service_with};

#[test]
fn schema_matches_the_input_struct() {
    let accept = json!({ "chatId": "c", "until": ["idle"], "timeoutMs": 1000 });
    assert_eq!(
        schema_properties(&definition().input_schema),
        fixture_keys(&accept)
    );
    assert!(parse_args::<Input>(accept).is_ok());
    assert!(parse_args::<Input>(json!({ "chatId": "c", "until": [] })).is_err());
    assert!(parse_args::<Input>(json!({ "chatId": "c", "until": ["busy"] })).is_err());
    assert!(parse_args::<Input>(json!({ "chatId": "c", "timeoutMs": 5 })).is_err());
}

fn setup() -> (std::sync::Arc<OrchestrationService>, CallCtx, FakePort) {
    let port = FakePort::new();
    port.add_chat("caller");
    let mut target = port.add_chat("target");
    target.working = true;
    port.put(target);
    let (svc, ctx) = service_with(port.clone(), "caller");
    (svc, ctx, port)
}

#[tokio::test(start_paused = true)]
async fn returns_on_the_event_without_polling() {
    let (svc, ctx, port) = setup();
    let waiter = {
        let svc = svc.clone();
        tokio::spawn(async move { run(&svc, &ctx, json!({ "chatId": "target" })).await })
    };
    tokio::task::yield_now().await;
    port.update("target", |c| c.working = false);
    port.touch("target");
    let out = waiter.await.unwrap().unwrap();
    assert_eq!(out["matched"], "idle");
    assert_eq!(out["waitTimedOut"], false);
}

#[tokio::test(start_paused = true)]
async fn returns_on_a_permission_gate_and_times_out_without_side_effects() {
    let (svc, ctx, port) = setup();
    let out = run(&svc, &ctx, json!({ "chatId": "target", "timeoutMs": 1000 }))
        .await
        .unwrap();
    assert_eq!(out["waitTimedOut"], true);
    assert_eq!(out["state"], "working");
    assert!(port.lock().interrupted.is_empty());

    port.update("target", |c| {
        c.pending_permission = Some(PendingPermissionView {
            tool_name: "Bash".into(),
            summary: "rm".into(),
        });
    });
    let out = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap();
    assert_eq!(out["matched"], "waiting_for_permission");
    assert_eq!(out["pendingPermission"]["toolName"], "Bash");
}

#[tokio::test]
async fn a_chat_may_not_wait_on_itself() {
    let (svc, ctx, _port) = setup();
    let err = run(&svc, &ctx, json!({ "chatId": "caller" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRequest);
}

/// A request above the internal safety cap never actually holds the
/// call open for the full requested duration: it returns `stillWaiting`
/// once the cap elapses, not a final `waitTimedOut`.
#[tokio::test(start_paused = true)]
async fn a_request_above_the_safety_cap_returns_still_waiting_at_the_cap() {
    let (svc, ctx, _port) = setup();
    let requested = MAX_SINGLE_WAIT_MS * 10;
    let start = tokio::time::Instant::now();
    let out = run(
        &svc,
        &ctx,
        json!({ "chatId": "target", "timeoutMs": requested }),
    )
    .await
    .unwrap();
    assert_eq!(out["waitTimedOut"], false);
    assert_eq!(out["stillWaiting"], true);
    assert_eq!(out["remainingMs"], requested - MAX_SINGLE_WAIT_MS);
    assert_eq!(start.elapsed(), Duration::from_millis(MAX_SINGLE_WAIT_MS));
}

/// The caller's original budget must actually run out: passing
/// `remainingMs` back as the next call's `timeoutMs` (the tool's own
/// instruction) eventually reaches a real `waitTimedOut`, instead of
/// every call resetting to a fresh cap's worth of `stillWaiting`
/// forever.
#[tokio::test(start_paused = true)]
async fn passing_remaining_ms_back_eventually_reaches_a_real_timeout() {
    let (svc, ctx, _port) = setup();
    let requested = MAX_SINGLE_WAIT_MS + 1000;
    let first = run(
        &svc,
        &ctx,
        json!({ "chatId": "target", "timeoutMs": requested }),
    )
    .await
    .unwrap();
    assert_eq!(first["stillWaiting"], true);
    assert_eq!(first["remainingMs"], 1000);

    let second = run(
        &svc,
        &ctx,
        json!({ "chatId": "target", "timeoutMs": first["remainingMs"].as_u64().unwrap() }),
    )
    .await
    .unwrap();
    assert_eq!(second["waitTimedOut"], true);
    assert_eq!(second["stillWaiting"], false);
    assert_eq!(second["remainingMs"], Value::Null);
}

/// A request at or under the cap behaves exactly as before: a real
/// timeout at the caller's own requested duration.
#[tokio::test(start_paused = true)]
async fn a_request_under_the_safety_cap_still_times_out_for_real() {
    let (svc, ctx, _port) = setup();
    let out = run(&svc, &ctx, json!({ "chatId": "target", "timeoutMs": 1000 }))
        .await
        .unwrap();
    assert_eq!(out["waitTimedOut"], true);
    assert_eq!(out["stillWaiting"], false);
}

#[tokio::test]
async fn a_chat_in_another_project_reads_as_not_found() {
    let (svc, ctx, port) = setup();
    port.update("target", |c| c.project_id = "other-project".into());
    let err = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ChatNotFound);
}

/// A chat the caller `chat_launch`ed into another project is still
/// waitable: lineage keeps it in scope even though its project differs.
#[tokio::test]
async fn a_chat_the_caller_launched_into_another_project_is_still_waitable() {
    let (svc, ctx, port) = setup();
    port.update("target", |c| {
        c.project_id = "other-project".into();
        c.created_by_chat_id = Some("caller".into());
        c.working = false;
    });
    let out = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap();
    assert_eq!(out["matched"], "idle");
}
