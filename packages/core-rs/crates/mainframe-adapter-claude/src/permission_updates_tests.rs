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

    assert_eq!(keep_mode_changes_session_scoped(input.clone()), input);
}

#[test]
fn set_mode_keeps_a_session_destination() {
    let input = vec![ControlUpdate::SetMode {
        mode: PermissionMode::AcceptEdits,
        destination: ControlDestination::Session,
    }];

    assert_eq!(keep_mode_changes_session_scoped(input.clone()), input);
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

        let output = keep_mode_changes_session_scoped(input);
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

    assert_eq!(keep_mode_changes_session_scoped(input.clone()), input);
}

#[test]
fn empty_input_returns_empty_output() {
    assert_eq!(keep_mode_changes_session_scoped(vec![]), vec![]);
}
