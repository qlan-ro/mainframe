//! What a permission answer may save is decided in the chat layer, for every
//! client. A child module of `tests`, so it sees its fakes.

use super::*;
use mainframe_types::adapter::{ControlBehavior, ControlUpdate};
use serde_json::json;

fn update(value: serde_json::Value) -> ControlUpdate {
    serde_json::from_value(value).unwrap()
}

fn rule() -> ControlUpdate {
    update(json!({
        "type": "addRules",
        "rules": [{ "toolName": "Bash", "ruleContent": "cargo test *" }],
        "behavior": "allow",
        "destination": "localSettings"
    }))
}

fn mode(name: &str) -> ControlUpdate {
    update(json!({ "type": "setMode", "mode": name, "destination": "session" }))
}

async fn answer(updates: Vec<ControlUpdate>) -> (Vec<ControlUpdate>, Vec<String>) {
    let mgr = ChatManager::new(FakeDeps::arc());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );
    mgr.respond_to_permission(
        "c1",
        ControlResponse {
            request_id: "r1".into(),
            tool_use_id: "t1".into(),
            tool_name: Some("Bash".into()),
            behavior: ControlBehavior::Allow,
            updated_input: None,
            updated_permissions: Some(updates),
            message: None,
            execution_mode: None,
            clear_context: None,
            scope: None,
        },
    )
    .await
    .unwrap();
    let sent = session.responded_calls.lock().unwrap()[0]
        .updated_permissions
        .clone()
        .unwrap();
    let lines = mgr
        .shared
        .messages
        .lock()
        .unwrap()
        .get("c1")
        .into_iter()
        .flatten()
        .filter(|message| message.r#type == ChatMessageType::System)
        .flat_map(|message| message.content.clone())
        .filter_map(|content| match content {
            MessageContent::Leaf(LeafContent::Text { text, .. }) => Some(text),
            _ => None,
        })
        .collect();
    (sent, lines)
}

#[tokio::test]
async fn a_mode_wider_than_auto_edits_is_taken_out_and_the_session_says_so() {
    for (name, label) in [
        ("yolo", "Unattended"),
        ("auto", "Auto"),
        ("bypassPermissions", "Unattended"),
    ] {
        let (sent, lines) = answer(vec![rule(), mode(name)]).await;

        assert_eq!(sent, vec![rule()]);
        assert_eq!(
            lines,
            vec![format!(
                "Not saved with the permission answer: switching permissions to {label}."
            )]
        );
    }
}

#[tokio::test]
async fn an_update_it_cannot_read_is_taken_out_and_the_session_says_so() {
    let (sent, lines) = answer(vec![
        update(json!({ "type": "someday", "everything": true })),
        rule(),
    ])
    .await;

    assert_eq!(sent, vec![rule()]);
    assert_eq!(
        lines,
        vec!["Not saved with the permission answer: a change that could not be read (someday)."]
    );
}

#[tokio::test]
async fn an_answer_it_may_save_in_full_is_forwarded_with_nothing_said() {
    let updates = vec![rule(), mode("acceptEdits"), mode("plan")];
    let (sent, lines) = answer(updates.clone()).await;

    assert_eq!(sent, updates);
    assert!(lines.is_empty());
}
