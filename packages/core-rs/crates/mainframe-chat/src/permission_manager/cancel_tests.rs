//! `PermissionManager::cancel` — removal by id, tombstone lifetime (D4).

use super::*;

fn request(request_id: &str) -> ControlRequest {
    ControlRequest {
        request_id: request_id.to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: format!("tu-{request_id}"),
        input: std::collections::HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
    }
}

fn seeded(chat_id: &str, ids: &[&str]) -> PermissionManager {
    let mut manager = PermissionManager::new();
    for id in ids {
        manager.enqueue(chat_id, request(id));
    }
    manager
}

#[test]
fn cancelling_the_front_request_returns_the_next_as_the_new_front() {
    let mut manager = seeded("chat-1", &["r1", "r2", "r3"]);

    let outcome = manager.cancel("chat-1", "r1");

    assert_eq!(
        outcome,
        CancelOutcome::Front {
            next: Some(request("r2"))
        }
    );
    assert_eq!(manager.get_pending("chat-1"), Some(&request("r2")));
}

#[test]
fn cancelling_a_middle_request_leaves_the_front_and_the_order_intact() {
    let mut manager = seeded("chat-1", &["r1", "r2", "r3"]);

    let outcome = manager.cancel("chat-1", "r2");

    assert_eq!(outcome, CancelOutcome::Queued);
    assert_eq!(manager.get_pending("chat-1"), Some(&request("r1")));
    assert_eq!(manager.shift("chat-1"), Some(request("r3")));
}

#[test]
fn cancelling_the_only_request_empties_the_chat() {
    let mut manager = seeded("chat-1", &["r1"]);

    let outcome = manager.cancel("chat-1", "r1");

    assert_eq!(outcome, CancelOutcome::Front { next: None });
    assert!(!manager.has_pending("chat-1"));
}

#[test]
fn cancelling_an_unknown_id_is_a_noop() {
    let mut manager = seeded("chat-1", &["r1", "r2"]);

    let outcome = manager.cancel("chat-1", "nope");

    assert_eq!(outcome, CancelOutcome::Unknown);
    assert_eq!(manager.get_pending("chat-1"), Some(&request("r1")));
    assert_eq!(manager.shift("chat-1"), Some(request("r2")));
}

#[test]
fn an_empty_request_id_never_matches_a_restored_placeholder() {
    let mut manager = PermissionManager::new();
    let tool_use = mainframe_types::chat::ChatMessage {
        id: "m1".to_string(),
        chat_id: "chat-1".to_string(),
        r#type: ChatMessageType::Assistant,
        content: vec![MessageContent::Node(MessageContentNode::ToolUse {
            id: "tu-1".to_string(),
            name: "Bash".to_string(),
            input: std::collections::HashMap::new(),
            parent_tool_use_id: None,
        })],
        timestamp: String::new(),
        metadata: None,
    };
    manager.restore_pending_permission("chat-1", std::slice::from_ref(&tool_use));
    assert!(manager.has_pending("chat-1"));

    let outcome = manager.cancel("chat-1", "");

    assert_eq!(outcome, CancelOutcome::Unknown);
    assert!(manager.has_pending("chat-1"));
}

#[test]
fn a_cancel_only_touches_the_named_chat() {
    let mut manager = PermissionManager::new();
    manager.enqueue("chat-a", request("shared"));
    manager.enqueue("chat-b", request("shared"));

    manager.cancel("chat-a", "shared");

    assert!(!manager.has_pending("chat-a"));
    assert_eq!(manager.get_pending("chat-b"), Some(&request("shared")));
}

#[test]
fn a_cancelled_id_is_remembered_per_chat() {
    let mut manager = seeded("chat-1", &["r1"]);

    manager.cancel("chat-1", "r1");

    assert!(manager.was_cancelled("chat-1", "r1"));
    assert!(!manager.was_cancelled("chat-2", "r1"));
}

#[test]
fn clearing_a_chat_does_not_un_cancel_a_request() {
    let mut manager = seeded("chat-1", &["r1"]);
    manager.cancel("chat-1", "r1");

    manager.clear("chat-1");
    assert!(manager.was_cancelled("chat-1", "r1"));

    manager.forget("chat-1");
    assert!(!manager.was_cancelled("chat-1", "r1"));
}

#[test]
fn cancelled_ids_are_bounded() {
    let mut manager = PermissionManager::new();
    for i in 0..40 {
        let id = format!("id-{i}");
        manager.enqueue("chat-1", request(&id));
        manager.cancel("chat-1", &id);
    }

    assert!(!manager.was_cancelled("chat-1", "id-0"));
    assert!(manager.was_cancelled("chat-1", "id-39"));
}
