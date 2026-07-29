//! `respond_to_permission` — the outbound `control_response` forwards each
//! `updatedPermissions` entry with the destination the CLI declared (#283),
//! instead of rewriting session-scoped updates to `localSettings`.

use super::tests::{read_json, session, spawned_with_stdin};

use mainframe_types::adapter::{
    ControlBehavior, ControlDestination, ControlResponse, ControlRule, ControlUpdate, RuleBehavior,
};
use mainframe_types::settings::PermissionMode;

fn response(updated_permissions: Vec<ControlUpdate>) -> ControlResponse {
    ControlResponse {
        request_id: "req-1".to_string(),
        tool_use_id: "tu-1".to_string(),
        tool_name: Some("Edit".to_string()),
        behavior: ControlBehavior::Allow,
        updated_input: None,
        updated_permissions: Some(updated_permissions),
        message: None,
        execution_mode: None,
        clear_context: None,
    }
}

#[tokio::test]
async fn always_allow_forwards_a_session_scoped_rule_verbatim() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);

    let update = ControlUpdate::AddRules {
        rules: vec![ControlRule {
            tool_name: "Edit".to_string(),
            rule_content: Some("/tmp/**".to_string()),
        }],
        behavior: RuleBehavior::Allow,
        destination: ControlDestination::Session,
    };
    s.respond_to_permission(response(vec![update]))
        .await
        .unwrap();

    let payload = read_json(&mut rx);
    let emitted = &payload["response"]["response"]["updatedPermissions"][0];
    assert_eq!(emitted["destination"], "session");
    assert_eq!(emitted["type"], "addRules");
}

#[tokio::test]
async fn set_mode_pointed_at_local_settings_is_forwarded_session_scoped() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);

    let update = ControlUpdate::SetMode {
        mode: PermissionMode::AcceptEdits,
        destination: ControlDestination::LocalSettings,
    };
    s.respond_to_permission(response(vec![update]))
        .await
        .unwrap();

    let payload = read_json(&mut rx);
    let emitted = &payload["response"]["response"]["updatedPermissions"][0];
    assert_eq!(emitted["destination"], "session");
    assert_eq!(emitted["mode"], "acceptEdits");
}
