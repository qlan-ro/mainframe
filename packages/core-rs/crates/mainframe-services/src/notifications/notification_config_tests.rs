use super::*;
use mainframe_types::settings::{
    NotificationChatConfig, NotificationOtherConfig, NotificationPermissionConfig,
};

fn config(chat: [bool; 3], permission: [bool; 3], plugin: bool) -> NotificationConfig {
    NotificationConfig {
        chat: NotificationChatConfig {
            task_complete: chat[0],
            session_error: chat[1],
            attention_request: chat[2],
        },
        permission: NotificationPermissionConfig {
            tool_request: permission[0],
            user_question: permission[1],
            plan_approval: permission[2],
        },
        other: NotificationOtherConfig { plugin },
    }
}

const ALL_ON: [bool; 3] = [true, true, true];

#[test]
fn returns_defaults_when_no_row_is_stored() {
    assert_eq!(
        parse_notification_config(None),
        config(ALL_ON, ALL_ON, true)
    );
}

#[test]
fn returns_defaults_when_stored_json_is_invalid() {
    assert_eq!(
        parse_notification_config(Some("not-json")),
        config(ALL_ON, ALL_ON, true)
    );
}

#[test]
fn honours_valid_overrides_exactly() {
    let stored = r#"{"chat":{"taskComplete":false},"other":{"plugin":false}}"#;
    assert_eq!(
        parse_notification_config(Some(stored)),
        config([false, true, true], ALL_ON, false)
    );
}

#[test]
fn salvages_valid_groups_when_one_group_has_a_bad_leaf() {
    let stored = r#"{"chat":{"taskComplete":false},"permission":{"toolRequest":"false","userQuestion":false}}"#;
    assert_eq!(
        parse_notification_config(Some(stored)),
        config([false, true, true], ALL_ON, true)
    );
}

#[test]
fn a_null_leaf_drops_its_group() {
    let stored = r#"{"chat":{"taskComplete":null,"sessionError":false},"other":{"plugin":false}}"#;
    assert_eq!(
        parse_notification_config(Some(stored)),
        config(ALL_ON, ALL_ON, false)
    );
}

#[test]
fn honours_a_stored_attention_request_override() {
    let stored = r#"{"chat":{"attentionRequest":false}}"#;
    assert_eq!(
        parse_notification_config(Some(stored)),
        config([true, true, false], ALL_ON, true)
    );
}

#[test]
fn a_non_boolean_attention_request_falls_back_to_the_whole_group_default() {
    let stored = r#"{"chat":{"taskComplete":false,"attentionRequest":"nope"}}"#;
    assert_eq!(
        parse_notification_config(Some(stored)),
        config(ALL_ON, ALL_ON, true)
    );
}

#[test]
fn drops_a_non_object_root_or_group_entirely() {
    assert_eq!(
        parse_notification_config(Some("123")),
        config(ALL_ON, ALL_ON, true)
    );
    assert_eq!(
        parse_notification_config(Some(r#"{"chat":[false],"other":"x"}"#)),
        config(ALL_ON, ALL_ON, true)
    );
}

#[test]
fn ignores_unknown_groups_and_keys_but_keeps_known_ones() {
    let stored = r#"{"chat":{"sessionError":false,"extra":1},"bogus":{"x":1}}"#;
    assert_eq!(
        parse_notification_config(Some(stored)),
        config([true, false, true], ALL_ON, true)
    );
}

#[test]
fn a_request_patch_is_strict_and_applies_only_present_leaves() {
    let patch: NotificationConfigPatch =
        serde_json::from_str(r#"{"permission":{"planApproval":false},"other":{}}"#).unwrap();
    let base = config([false, true, true], ALL_ON, false);
    assert_eq!(
        patch.apply_to(base),
        config([false, true, true], [true, true, false], false)
    );
    assert!(
        serde_json::from_str::<NotificationConfigPatch>(r#"{"chat":{"taskComplete":"yes"}}"#)
            .is_err()
    );
    assert!(serde_json::from_str::<NotificationConfigPatch>(r#"{"chat":7}"#).is_err());
}

#[test]
fn routes_ask_user_question_to_permission_user_question() {
    let cfg = NotificationConfig::default();
    let mut off = cfg.clone();
    off.permission.user_question = false;
    assert!(!should_notify_permission(&off, Some("AskUserQuestion")));
    assert!(should_notify_permission(&cfg, Some("AskUserQuestion")));
}

#[test]
fn routes_exit_plan_mode_to_permission_plan_approval() {
    let mut off = NotificationConfig::default();
    off.permission.plan_approval = false;
    assert!(!should_notify_permission(&off, Some("ExitPlanMode")));
}

#[test]
fn routes_everything_else_to_permission_tool_request() {
    let mut off = NotificationConfig::default();
    off.permission.tool_request = false;
    assert!(!should_notify_permission(&off, Some("Bash")));
    assert!(!should_notify_permission(&off, None));
}
