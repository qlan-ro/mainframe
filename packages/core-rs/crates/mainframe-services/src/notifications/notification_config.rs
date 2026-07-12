//! Ported from `src/notifications/notification-config.ts`.

use mainframe_types::settings::NotificationConfig;
use serde_json::Value;

use crate::settings::provider_config::SettingsReader;

/// Salvage a chat group (`{ taskComplete?, sessionError? }`). Returns `None` when
/// a present known key is the wrong type (Zod `.safeParse` failure); unknown keys
/// are ignored (Zod strips them).
fn salvage_chat(value: Option<&Value>) -> Option<(Option<bool>, Option<bool>)> {
    let obj = value?.as_object()?;
    let mut task_complete = None;
    let mut session_error = None;
    for (key, val) in obj {
        match key.as_str() {
            "taskComplete" => task_complete = Some(val.as_bool()?),
            "sessionError" => session_error = Some(val.as_bool()?),
            _ => {}
        }
    }
    Some((task_complete, session_error))
}

fn salvage_permission(value: Option<&Value>) -> Option<(Option<bool>, Option<bool>, Option<bool>)> {
    let obj = value?.as_object()?;
    let mut tool_request = None;
    let mut user_question = None;
    let mut plan_approval = None;
    for (key, val) in obj {
        match key.as_str() {
            "toolRequest" => tool_request = Some(val.as_bool()?),
            "userQuestion" => user_question = Some(val.as_bool()?),
            "planApproval" => plan_approval = Some(val.as_bool()?),
            _ => {}
        }
    }
    Some((tool_request, user_question, plan_approval))
}

fn salvage_other(value: Option<&Value>) -> Option<Option<bool>> {
    let obj = value?.as_object()?;
    let mut plugin = None;
    for (key, val) in obj {
        if key == "plugin" {
            plugin = Some(val.as_bool()?);
        }
    }
    Some(plugin)
}

/// Read the notification config from the settings DB. Falls back to defaults
/// (everything enabled) if no row exists or the JSON is malformed. Each group
/// (chat / permission / other) is validated independently; corruption in one
/// group falls back to that group's defaults without disturbing the others.
pub fn read_notification_config(db: &impl SettingsReader) -> NotificationConfig {
    let defaults = NotificationConfig::default();
    let Some(raw) = db.get("general", "notifications") else {
        return defaults;
    };
    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        // expected: malformed stored JSON → fall back to defaults
        Err(_) => return defaults,
    };
    let empty = Value::Object(serde_json::Map::new());
    let root = if parsed.is_object() { &parsed } else { &empty };

    let mut config = defaults;
    if let Some((task_complete, session_error)) = salvage_chat(root.get("chat")) {
        if let Some(v) = task_complete {
            config.chat.task_complete = v;
        }
        if let Some(v) = session_error {
            config.chat.session_error = v;
        }
    }
    if let Some((tool_request, user_question, plan_approval)) =
        salvage_permission(root.get("permission"))
    {
        if let Some(v) = tool_request {
            config.permission.tool_request = v;
        }
        if let Some(v) = user_question {
            config.permission.user_question = v;
        }
        if let Some(v) = plan_approval {
            config.permission.plan_approval = v;
        }
    }
    if let Some(Some(v)) = salvage_other(root.get("other")) {
        config.other.plugin = v;
    }
    config
}

/// Returns true if the OS notification for a permission request should fire,
/// given the tool name.
pub fn should_notify_permission(config: &NotificationConfig, tool_name: Option<&str>) -> bool {
    if tool_name == Some("AskUserQuestion") {
        return config.permission.user_question;
    }
    if tool_name == Some("ExitPlanMode") {
        return config.permission.plan_approval;
    }
    config.permission.tool_request
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeDb {
        stored: Option<String>,
    }

    impl SettingsReader for FakeDb {
        fn get(&self, _ns: &str, _key: &str) -> Option<String> {
            self.stored.clone()
        }
    }

    fn fake_db(stored: Option<&str>) -> FakeDb {
        FakeDb {
            stored: stored.map(|s| s.to_string()),
        }
    }

    #[test]
    fn returns_defaults_when_no_row_is_stored() {
        assert_eq!(
            read_notification_config(&fake_db(None)),
            NotificationConfig::default()
        );
    }

    #[test]
    fn returns_defaults_when_stored_json_is_invalid() {
        assert_eq!(
            read_notification_config(&fake_db(Some("not-json"))),
            NotificationConfig::default()
        );
    }

    #[test]
    fn honours_valid_overrides_exactly() {
        let stored = r#"{"chat":{"taskComplete":false},"other":{"plugin":false}}"#;
        let mut expected = NotificationConfig::default();
        expected.chat.task_complete = false;
        expected.other.plugin = false;
        assert_eq!(read_notification_config(&fake_db(Some(stored))), expected);
    }

    #[test]
    fn salvages_valid_groups_when_one_group_has_a_bad_leaf() {
        let stored = r#"{"chat":{"taskComplete":false},"permission":{"toolRequest":"false"}}"#;
        let result = read_notification_config(&fake_db(Some(stored)));
        assert!(!result.chat.task_complete);
        assert_eq!(
            result.permission.tool_request,
            NotificationConfig::default().permission.tool_request
        );
    }

    #[test]
    fn drops_a_non_object_root_entirely() {
        assert_eq!(
            read_notification_config(&fake_db(Some("123"))),
            NotificationConfig::default()
        );
    }

    #[test]
    fn drops_unknown_groups_but_keeps_known_ones() {
        let stored = r#"{"chat":{"sessionError":false},"bogus":{"x":1}}"#;
        let result = read_notification_config(&fake_db(Some(stored)));
        assert!(!result.chat.session_error);
        assert_eq!(result.permission, NotificationConfig::default().permission);
        assert_eq!(result.other, NotificationConfig::default().other);
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
}

// PORT STATUS: src/notifications/notification-config.ts (55 lines)
// confidence: high
// todos: 0
// notes: Zod per-group `.partial()` salvage → salvage_* fns: a present known key
// of the wrong type fails the whole group (val.as_bool()? → None), unknown keys
// ignored (Zod strips). Non-object root → {} → all defaults. NOTIFICATION_DEFAULTS
// is NotificationConfig::default() (types crate). Takes `&impl SettingsReader`
// (the shared trait) rather than DatabaseManager so it is testable with a fake,
// mirroring the TS test's fakeDb; the real DB satisfies the trait.
