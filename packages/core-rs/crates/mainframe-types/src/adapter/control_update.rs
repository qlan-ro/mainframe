//! What a permission answer may save: the updates themselves, and the line no
//! answer crosses. A permission mode that approves more than file edits is a
//! deliberate choice on the composer's permissions control, never the side
//! effect of answering one prompt, and an update this build cannot read is not
//! passed on unread. Held here for every client; the desktop gate holds it too,
//! and lists what it leaves out (`gates/permission-grants.ts`).

use serde::{Deserialize, Serialize};

use super::ControlResponse;
use crate::settings::PermissionMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlDestination {
    UserSettings,
    ProjectSettings,
    LocalSettings,
    Session,
    CliArg,
}

/// Behavior selector on rule-mutating `ControlUpdate` variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleBehavior {
    Allow,
    Deny,
    Ask,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlRule {
    pub tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_content: Option<String>,
}

/// A control rule update to save for future tool uses.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ControlUpdate {
    AddRules {
        rules: Vec<ControlRule>,
        behavior: RuleBehavior,
        destination: ControlDestination,
    },
    ReplaceRules {
        rules: Vec<ControlRule>,
        behavior: RuleBehavior,
        destination: ControlDestination,
    },
    RemoveRules {
        rules: Vec<ControlRule>,
        behavior: RuleBehavior,
        destination: ControlDestination,
    },
    SetMode {
        mode: PermissionMode,
        destination: ControlDestination,
    },
    AddDirectories {
        directories: Vec<String>,
        destination: ControlDestination,
    },
    RemoveDirectories {
        directories: Vec<String>,
        destination: ControlDestination,
    },
    /// A suggestion this build cannot read, kept as it came so the gate can say
    /// that it was left out. Never forwarded to an agent.
    #[serde(untagged)]
    Unknown(serde_json::Value),
}

impl ControlUpdate {
    /// Whether a permission answer may save this.
    pub fn grantable(&self) -> bool {
        match self {
            Self::SetMode { mode, .. } => match mode {
                PermissionMode::Default | PermissionMode::Plan | PermissionMode::AcceptEdits => {
                    true
                }
                PermissionMode::Auto | PermissionMode::Yolo => false,
            },
            Self::Unknown(_) => false,
            Self::AddRules { .. }
            | Self::ReplaceRules { .. }
            | Self::RemoveRules { .. }
            | Self::AddDirectories { .. }
            | Self::RemoveDirectories { .. } => true,
        }
    }

    /// What was not saved, in the words of the app's permissions control.
    pub fn withheld_label(&self) -> String {
        match self {
            Self::SetMode { mode, .. } => mode_label(&serde_json::json!(mode)),
            Self::Unknown(value) => match value.get("type").and_then(plain_name) {
                Some("setMode") => mode_label(&value["mode"]),
                Some(name) => format!("a change that could not be read ({name})"),
                None => "a change that could not be read".to_string(),
            },
            _ => "a change".to_string(),
        }
    }
}

fn mode_label(mode: &serde_json::Value) -> String {
    match plain_name(mode) {
        Some("yolo" | "bypassPermissions") => "switching permissions to Unattended".to_string(),
        Some("auto") => "switching permissions to Auto".to_string(),
        Some(name) => format!("switching permissions to “{name}”"),
        None => "switching permissions".to_string(),
    }
}

/// A name plain enough to show. It comes from the agent, so anything else is not.
fn plain_name(value: &serde_json::Value) -> Option<&str> {
    value.as_str().filter(|name| {
        (1..=40).contains(&name.len())
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    })
}

impl ControlResponse {
    /// Takes out of the answer everything it may not save, and returns it.
    pub fn withhold_ungrantable(&mut self) -> Vec<ControlUpdate> {
        let Some(updates) = self.updated_permissions.take() else {
            return Vec::new();
        };
        let (kept, withheld) = updates.into_iter().partition(ControlUpdate::grantable);
        self.updated_permissions = Some(kept);
        withheld
    }
}

#[cfg(test)]
#[path = "control_update_tests.rs"]
mod tests;
