use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;
use serde_json::json;

use super::*;
use crate::input::golden::{fixture_keys, schema_properties};
use crate::service::CallCtx;
use crate::state::{AgentMessageKind, wrap_agent_message};
use crate::test_support::{FakePort, service_with};

fn text_message(id: &str, kind: ChatMessageType, text: &str) -> ChatMessage {
    ChatMessage {
        id: id.into(),
        chat_id: "target".into(),
        r#type: kind,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: text.into(),
            parent_tool_use_id: None,
        })],
        timestamp: "t".into(),
        metadata: None,
    }
}

fn setup(messages: Vec<ChatMessage>) -> (std::sync::Arc<OrchestrationService>, CallCtx, FakePort) {
    let port = FakePort::new();
    port.add_chat("caller");
    port.add_chat("target");
    port.lock().messages.insert("target".into(), messages);
    let (svc, ctx) = service_with(port.clone(), "caller");
    (svc, ctx, port)
}

fn ids(out: &Value) -> Vec<String> {
    out["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["messageId"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn schema_matches_the_input_struct() {
    let accept = json!({
        "chatId": "c", "view": "activity", "cursor": "x", "limit": 3, "maxChars": 200,
        "fromEnd": false, "messageId": "m", "textOffset": 0
    });
    assert_eq!(
        schema_properties(&definition().input_schema),
        fixture_keys(&accept)
    );
    assert!(parse_args::<Input>(accept).is_ok());
    assert!(parse_args::<Input>(json!({})).is_err());
    assert!(parse_args::<Input>(json!({ "chatId": "c", "textOffset": 3 })).is_err());
    assert!(parse_args::<Input>(json!({ "chatId": "c", "maxChars": 50 })).is_err());
    assert!(parse_args::<Input>(json!({ "chatId": "c", "x": 1 })).is_err());
}

#[tokio::test]
async fn reads_latest_then_pages_forward_from_a_cursor() {
    let messages = (0..5)
        .map(|i| text_message(&format!("m{i}"), ChatMessageType::User, &format!("hi {i}")))
        .collect();
    let (svc, ctx, _) = setup(messages);
    let latest = run(&svc, &ctx, json!({ "chatId": "target", "limit": 2 }))
        .await
        .unwrap();
    assert_eq!(ids(&latest), vec!["m3", "m4"]);
    assert_eq!(latest["lastPosition"], 4);
    assert!(latest["nextCursor"].is_null());

    let first = run(
        &svc,
        &ctx,
        json!({ "chatId": "target", "limit": 2, "fromEnd": false }),
    )
    .await
    .unwrap();
    assert_eq!(ids(&first), vec!["m0", "m1"]);
    let cursor = first["nextCursor"].as_str().unwrap().to_string();
    let next = run(
        &svc,
        &ctx,
        json!({ "chatId": "target", "limit": 2, "cursor": cursor }),
    )
    .await
    .unwrap();
    assert_eq!(ids(&next), vec!["m2", "m3"]);
}

#[tokio::test]
async fn a_cursor_relocates_when_positions_shift_and_fails_when_its_id_is_gone() {
    let messages = (0..4)
        .map(|i| text_message(&format!("m{i}"), ChatMessageType::User, "x"))
        .collect();
    let (svc, ctx, port) = setup(messages);
    let cursor = encode_cursor(1, "m1");
    port.lock().messages.get_mut("target").unwrap().remove(0);
    let out = run(&svc, &ctx, json!({ "chatId": "target", "cursor": cursor }))
        .await
        .unwrap();
    assert_eq!(ids(&out), vec!["m2", "m3"]);

    let gone = encode_cursor(0, "nope");
    let err = run(&svc, &ctx, json!({ "chatId": "target", "cursor": gone }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidCursor);
}

#[tokio::test]
async fn long_items_truncate_and_continue_by_text_offset() {
    let long = "a".repeat(500);
    let (svc, ctx, _) = setup(vec![text_message("m0", ChatMessageType::Assistant, &long)]);
    let out = run(&svc, &ctx, json!({ "chatId": "target", "maxChars": 200 }))
        .await
        .unwrap();
    assert_eq!(out["items"][0]["textTruncated"], true);
    assert_eq!(out["items"][0]["nextTextOffset"], 200);
    let rest = run(
        &svc,
        &ctx,
        json!({ "chatId": "target", "messageId": "m0", "textOffset": 400, "maxChars": 200 }),
    )
    .await
    .unwrap();
    assert_eq!(rest["items"][0]["text"].as_str().unwrap().len(), 100);
    assert_eq!(rest["items"][0]["textTruncated"], false);
}

#[tokio::test]
async fn agent_messages_report_agent_origin_and_the_view_filters_activity() {
    let marked = wrap_agent_message("caller", AgentMessageKind::Send, "do it");
    let (svc, ctx, _) = setup(vec![
        text_message("m0", ChatMessageType::User, &marked),
        text_message("m1", ChatMessageType::System, "system note"),
    ]);
    let messages = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap();
    assert_eq!(ids(&messages), vec!["m0"]);
    assert_eq!(messages["items"][0]["origin"], "agent");
    let activity = run(
        &svc,
        &ctx,
        json!({ "chatId": "target", "view": "activity" }),
    )
    .await
    .unwrap();
    assert_eq!(ids(&activity), vec!["m0", "m1"]);
    assert_eq!(activity["items"][1]["origin"], "mainframe");
}

#[tokio::test]
async fn side_chats_read_as_not_found() {
    let (svc, ctx, port) = setup(Vec::new());
    port.update("target", |c| c.temporary = true);
    let err = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ChatNotFound);
}

#[tokio::test]
async fn a_chat_in_another_project_reads_as_not_found() {
    let (svc, ctx, port) = setup(Vec::new());
    port.update("target", |c| c.project_id = "other-project".into());
    let err = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ChatNotFound);
}

/// A chat the caller `chat_launch`ed into another project (or "no-project")
/// stays reachable: project scoping alone would read it as not found, since
/// it is not in the caller's own project, but the caller's own lineage
/// (`created_by_chat_id` on the launched chat) keeps it in scope.
#[tokio::test]
async fn a_chat_the_caller_launched_into_another_project_stays_in_scope() {
    let (svc, ctx, port) = setup(Vec::new());
    port.update("target", |c| {
        c.project_id = "other-project".into();
        c.created_by_chat_id = Some("caller".into());
    });
    let out = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap();
    assert_eq!(out["chatId"], "target");
}

/// Lineage reaches transitively: the caller launched X, X later launched Y.
/// The caller may still read Y, even though neither Y's project nor its
/// direct `created_by_chat_id` names the caller.
#[tokio::test]
async fn lineage_scope_reaches_through_a_chain_of_plain_launches() {
    let (svc, ctx, port) = setup(Vec::new());
    port.add_chat("x");
    port.update("x", |c| {
        c.project_id = "other-project".into();
        c.created_by_chat_id = Some("caller".into());
    });
    port.update("target", |c| {
        c.project_id = "third-project".into();
        c.created_by_chat_id = Some("x".into());
    });
    let out = run(&svc, &ctx, json!({ "chatId": "target" }))
        .await
        .unwrap();
    assert_eq!(out["chatId"], "target");
}
