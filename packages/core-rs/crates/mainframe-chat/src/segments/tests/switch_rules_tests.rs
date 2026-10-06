//! The refusal table: each row's status and message, in order.

use std::collections::HashMap;

use mainframe_types::adapter::{AdapterCapabilities, AdapterInfo, AdapterModel};
use mainframe_types::background_task::BackgroundActivity;
use mainframe_types::chat::{Chat, DisplayStatus, ProcessState};

use crate::segments::switch_rules::{SwitchCheck, SwitchError, check_switch_allowed};

fn codex(installed: bool) -> AdapterInfo {
    AdapterInfo {
        id: "codex".into(),
        name: "Codex".into(),
        description: String::new(),
        installed,
        version: None,
        models: vec![
            serde_json::from_value::<AdapterModel>(serde_json::json!({
                "id": "codex-pro", "label": "Pro", "contextWindow": 200000
            }))
            .unwrap(),
        ],
        models_revision: None,
        catalog_source: None,
        capabilities: AdapterCapabilities {
            plan_mode: true,
            auto_mode: false,
            no_persistence: true,
            fork: true,
        },
        fork_unavailable_reason: None,
    }
}

fn check(
    chat: &Chat,
    target: Option<&AdapterInfo>,
    model: Option<&str>,
    queued: usize,
) -> Result<(), SwitchError> {
    check_switch_allowed(&SwitchCheck {
        chat,
        target_id: "codex",
        target,
        model,
        queued,
        from_name: "Claude",
    })
}

fn idle_chat() -> Chat {
    crate::test_support::test_chat("chat_1")
}

#[test]
fn an_idle_chat_may_switch() {
    assert_eq!(
        check(&idle_chat(), Some(&codex(true)), Some("codex-pro"), 0),
        Ok(())
    );
    assert_eq!(
        check(&idle_chat(), Some(&codex(true)), Some("default"), 0),
        Ok(())
    );
}

#[test]
fn refusals_come_in_table_order_with_their_status_and_copy() {
    let mut chat = idle_chat();
    chat.temporary = true;
    chat.parent_chat_id = Some(Some("parent".into()));
    chat.process_state = Some(Some(ProcessState::Working));

    let err = check(&chat, None, None, 3).unwrap_err();
    assert_eq!(
        (err.status(), err.to_string()),
        (422, "codex isn't installed".to_string())
    );
    let err = check(&chat, Some(&codex(false)), None, 3).unwrap_err();
    assert_eq!(err.to_string(), "Codex isn't installed");
    let err = check(&chat, Some(&codex(true)), Some("gpt-x"), 3).unwrap_err();
    assert_eq!(
        (err.status(), err.to_string()),
        (422, "gpt-x isn't a Codex model".to_string())
    );
    let err = check(&chat, Some(&codex(true)), None, 3).unwrap_err();
    assert_eq!(
        (err.status(), err.to_string()),
        (409, "Side chats keep their parent's provider".to_string())
    );
    chat.parent_chat_id = None;
    let err = check(&chat, Some(&codex(true)), None, 3).unwrap_err();
    assert_eq!(err.to_string(), "Temporary chats can't switch providers");
    chat.temporary = false;
    let err = check(&chat, Some(&codex(true)), None, 3).unwrap_err();
    assert_eq!(
        err.to_string(),
        "Wait for the current turn to finish or interrupt it"
    );
    chat.process_state = None;
    chat.display_status = Some(DisplayStatus::Waiting);
    assert_eq!(
        check(&chat, Some(&codex(true)), None, 3),
        Err(SwitchError::TurnInFlight)
    );
    chat.display_status = None;
    let err = check(&chat, Some(&codex(true)), None, 3).unwrap_err();
    assert_eq!(
        err.to_string(),
        "Send or cancel queued messages before switching providers"
    );
    chat.background_activity = Some(BackgroundActivity {
        total: 1,
        by_kind: HashMap::new(),
        tasks: vec![],
    });
    let err = check(&chat, Some(&codex(true)), None, 0).unwrap_err();
    assert_eq!(
        (err.status(), err.to_string()),
        (
            409,
            "Claude is still running background agents or commands, and switching would end them. \
             Wait for them to finish, or press Stop, then switch."
                .to_string()
        )
    );
}

#[test]
fn not_found_and_failures_map_to_404_and_500() {
    assert_eq!(SwitchError::NotFound("c".into()).status(), 404);
    assert_eq!(
        SwitchError::NotFound("c".into()).to_string(),
        "Chat c not found"
    );
    assert_eq!(SwitchError::Failed("x".into()).status(), 500);
}
