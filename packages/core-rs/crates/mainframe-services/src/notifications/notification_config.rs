//! The notification settings: the stored `general.notifications` JSON and the
//! partial patch `PUT /api/settings/general` accepts share one set of partial
//! group types, so the stored-config reader and the request parser cannot
//! disagree on key names or leaf types.

use mainframe_types::settings::NotificationConfig;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

/// A present leaf must be a boolean (`null` is rejected, as Zod's
/// `z.boolean().optional()` does); an absent leaf is `None`.
fn present_bool<'de, D: Deserializer<'de>>(d: D) -> Result<Option<bool>, D::Error> {
    bool::deserialize(d).map(Some)
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationChatPatch {
    #[serde(default, deserialize_with = "present_bool")]
    pub task_complete: Option<bool>,
    #[serde(default, deserialize_with = "present_bool")]
    pub session_error: Option<bool>,
    #[serde(default, deserialize_with = "present_bool")]
    pub attention_request: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPermissionPatch {
    #[serde(default, deserialize_with = "present_bool")]
    pub tool_request: Option<bool>,
    #[serde(default, deserialize_with = "present_bool")]
    pub user_question: Option<bool>,
    #[serde(default, deserialize_with = "present_bool")]
    pub plan_approval: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
pub struct NotificationOtherPatch {
    #[serde(default, deserialize_with = "present_bool")]
    pub plugin: Option<bool>,
}

/// A partial `NotificationConfig`: every group and leaf is optional; unknown
/// keys are ignored.
#[derive(Debug, Default, Deserialize)]
pub struct NotificationConfigPatch {
    pub chat: Option<NotificationChatPatch>,
    pub permission: Option<NotificationPermissionPatch>,
    pub other: Option<NotificationOtherPatch>,
}

impl NotificationConfigPatch {
    /// `base` with every present leaf of this patch written over it.
    #[must_use]
    pub fn apply_to(&self, mut base: NotificationConfig) -> NotificationConfig {
        if let Some(chat) = &self.chat {
            overlay(&mut base.chat.task_complete, chat.task_complete);
            overlay(&mut base.chat.session_error, chat.session_error);
            overlay(&mut base.chat.attention_request, chat.attention_request);
        }
        if let Some(permission) = &self.permission {
            overlay(&mut base.permission.tool_request, permission.tool_request);
            overlay(&mut base.permission.user_question, permission.user_question);
            overlay(&mut base.permission.plan_approval, permission.plan_approval);
        }
        if let Some(other) = &self.other {
            overlay(&mut base.other.plugin, other.plugin);
        }
        base
    }

    /// Lenient per-group read of a stored document: a group that is absent,
    /// not an object, or has an ill-typed known leaf is dropped on its own.
    fn salvage(root: &Value) -> Self {
        Self {
            chat: salvage_group(root, "chat"),
            permission: salvage_group(root, "permission"),
            other: salvage_group(root, "other"),
        }
    }
}

fn overlay(slot: &mut bool, value: Option<bool>) {
    if let Some(value) = value {
        *slot = value;
    }
}

fn salvage_group<T: DeserializeOwned>(root: &Value, key: &str) -> Option<T> {
    let group = root.get(key).filter(|group| group.is_object())?;
    serde_json::from_value(group.clone()).ok()
}

/// The effective notification config for a stored `general.notifications`
/// value. No row, malformed JSON, or a non-object root yields the defaults
/// (everything enabled); otherwise each group is validated independently and a
/// corrupt group falls back to its defaults without disturbing the others.
#[must_use]
pub fn parse_notification_config(raw: Option<&str>) -> NotificationConfig {
    let root = raw
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok()) // expected: malformed JSON → defaults
        .unwrap_or(Value::Null);
    NotificationConfigPatch::salvage(&root).apply_to(NotificationConfig::default())
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
#[path = "notification_config_tests.rs"]
mod tests;
