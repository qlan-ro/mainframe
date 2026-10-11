use serde_json::json;

use super::*;
use crate::input::golden::{fixture_keys, schema_properties};
use crate::outbox::OutboxKind;
use crate::test_support::{FakePort, service_with};

#[test]
fn schema_matches_the_input_struct() {
    let accept = json!({ "chatId": "c", "reason": "done" });
    assert_eq!(
        schema_properties(&definition().input_schema),
        fixture_keys(&accept)
    );
    assert!(parse_args::<Input>(accept).is_ok());
    assert!(parse_args::<Input>(json!({ "chatId": "c", "reason": "x".repeat(501) })).is_err());
}

#[tokio::test]
async fn interrupts_a_busy_chat_and_drops_what_was_held_for_it() {
    let port = FakePort::new();
    for id in ["caller", "target"] {
        let mut chat = port.add_chat(id);
        chat.working = true;
        port.put(chat);
    }
    let (svc, ctx) = service_with(port.clone(), "caller");
    svc.outbox
        .push("target", "caller", OutboxKind::Send, "x".into(), "x");
    let out = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap();
    assert_eq!(out["interrupted"], true);
    assert_eq!(port.lock().interrupted, vec!["target".to_string()]);
    assert!(!svc.outbox.has_for("target"));
    let err = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::NoActiveTurn);
}

#[tokio::test]
async fn a_chat_in_another_project_reads_as_not_found() {
    let port = FakePort::new();
    let mut caller = port.add_chat("caller");
    caller.working = true;
    port.put(caller);
    let mut target = port.add_chat("target");
    target.working = true;
    target.project_id = "other-project".into();
    port.put(target);
    let (svc, ctx) = service_with(port.clone(), "caller");
    let err = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ChatNotFound);
}

/// A chat the caller `chat_launch`ed into another project stays
/// interruptible: lineage keeps it in scope even though its project
/// differs from the caller's.
#[tokio::test]
async fn a_chat_the_caller_launched_into_another_project_is_still_interruptible() {
    let port = FakePort::new();
    let mut caller = port.add_chat("caller");
    caller.working = true;
    port.put(caller);
    let mut target = port.add_chat("target");
    target.working = true;
    target.project_id = "other-project".into();
    target.created_by_chat_id = Some("caller".into());
    port.put(target);
    let (svc, ctx) = service_with(port.clone(), "caller");
    let out = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap();
    assert_eq!(out["interrupted"], true);
}
