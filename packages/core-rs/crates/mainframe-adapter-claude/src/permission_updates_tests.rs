use super::*;
use mainframe_types::adapter::{ControlRule, RuleBehavior};
use mainframe_types::settings::PermissionMode;

#[test]
fn non_set_mode_updates_pass_through_unchanged() {
    let input = vec![
        ControlUpdate::AddRules {
            rules: vec![ControlRule {
                tool_name: "Edit".to_string(),
                rule_content: Some("/tmp/**".to_string()),
            }],
            behavior: RuleBehavior::Allow,
            destination: ControlDestination::Session,
        },
        ControlUpdate::ReplaceRules {
            rules: vec![ControlRule {
                tool_name: "Bash".to_string(),
                rule_content: None,
            }],
            behavior: RuleBehavior::Allow,
            destination: ControlDestination::LocalSettings,
        },
        ControlUpdate::RemoveRules {
            rules: vec![ControlRule {
                tool_name: "Read".to_string(),
                rule_content: None,
            }],
            behavior: RuleBehavior::Deny,
            destination: ControlDestination::ProjectSettings,
        },
        ControlUpdate::AddDirectories {
            directories: vec!["/tmp".to_string()],
            destination: ControlDestination::Session,
        },
        ControlUpdate::RemoveDirectories {
            directories: vec!["/tmp".to_string()],
            destination: ControlDestination::UserSettings,
        },
    ];

    assert_eq!(forwardable_updates(input.clone()), input);
}

#[test]
fn set_mode_keeps_a_session_destination() {
    let input = vec![ControlUpdate::SetMode {
        mode: PermissionMode::AcceptEdits,
        destination: ControlDestination::Session,
    }];

    assert_eq!(forwardable_updates(input.clone()), input);
}

#[test]
fn set_mode_is_downgraded_from_every_persisting_destination() {
    for destination in [
        ControlDestination::UserSettings,
        ControlDestination::ProjectSettings,
        ControlDestination::LocalSettings,
    ] {
        let input = vec![ControlUpdate::SetMode {
            mode: PermissionMode::AcceptEdits,
            destination,
        }];

        let output = forwardable_updates(input);
        assert_eq!(
            output,
            vec![ControlUpdate::SetMode {
                mode: PermissionMode::AcceptEdits,
                destination: ControlDestination::Session,
            }]
        );
    }
}

#[test]
fn set_mode_keeps_a_cli_arg_destination() {
    let input = vec![ControlUpdate::SetMode {
        mode: PermissionMode::AcceptEdits,
        destination: ControlDestination::CliArg,
    }];

    assert_eq!(forwardable_updates(input.clone()), input);
}

#[test]
fn empty_input_returns_empty_output() {
    assert_eq!(forwardable_updates(vec![]), vec![]);
}

#[test]
fn no_mode_wider_than_auto_edits_is_forwarded() {
    let set = |mode| ControlUpdate::SetMode {
        mode,
        destination: ControlDestination::Session,
    };

    let output = forwardable_updates(vec![
        set(PermissionMode::Yolo),
        set(PermissionMode::Auto),
        set(PermissionMode::AcceptEdits),
    ]);

    assert_eq!(output, vec![set(PermissionMode::AcceptEdits)]);
}

#[test]
fn an_update_it_cannot_read_is_not_forwarded() {
    let unread = serde_json::json!({ "type": "grantEverything" });
    assert_eq!(
        forwardable_updates(vec![ControlUpdate::Unknown(unread)]),
        vec![]
    );
}
