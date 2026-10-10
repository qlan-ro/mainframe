//! Shared input plumbing: JSON Schema fragments for `tools/list`, and the
//! `deny_unknown_fields` + explicit `validate()` idiom every tool input uses
//! (the `ws_schemas.rs` pattern). The schema is what the model sees; the serde
//! struct plus `validate()` is what the server enforces, and each tool's
//! golden test pins the two together.

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::errors::ToolError;
use crate::policy::{MAX_WAIT_MS, MIN_WAIT_MS, TEXT_MAX};

pub trait Validate {
    fn validate(&self) -> Result<(), ToolError>;
}

/// Deserializes and validates tool arguments. A missing `arguments` is `{}`.
pub(crate) fn parse_args<T: DeserializeOwned + Validate>(args: Value) -> Result<T, ToolError> {
    let args = if args.is_null() { json!({}) } else { args };
    let parsed: T = serde_json::from_value(args).map_err(|e| ToolError::invalid(e.to_string()))?;
    parsed.validate()?;
    Ok(parsed)
}

pub fn check_id(field: &str, value: &str) -> Result<(), ToolError> {
    let ok = !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(ToolError::invalid(format!(
            "{field} must match ^[a-zA-Z0-9_-]{{1,64}}$"
        )))
    }
}

pub(crate) fn check_opt_id(field: &str, value: Option<&str>) -> Result<(), ToolError> {
    value.map_or(Ok(()), |v| check_id(field, v))
}

pub(crate) fn check_len(field: &str, value: &str, min: usize, max: usize) -> Result<(), ToolError> {
    let len = value.chars().count();
    if len < min || len > max {
        return Err(ToolError::invalid(format!(
            "{field} must be {min} to {max} characters"
        )));
    }
    Ok(())
}

pub(crate) fn check_opt_len(field: &str, value: Option<&str>, max: usize) -> Result<(), ToolError> {
    value.map_or(Ok(()), |v| check_len(field, v, 0, max))
}

pub(crate) fn check_text(field: &str, value: &str) -> Result<(), ToolError> {
    check_len(field, value, 1, TEXT_MAX)
}

pub(crate) fn check_range(field: &str, value: u64, min: u64, max: u64) -> Result<(), ToolError> {
    if value < min || value > max {
        return Err(ToolError::invalid(format!(
            "{field} must be between {min} and {max}"
        )));
    }
    Ok(())
}

pub(crate) fn check_timeout(field: &str, value: Option<u64>) -> Result<(), ToolError> {
    value.map_or(Ok(()), |v| check_range(field, v, MIN_WAIT_MS, MAX_WAIT_MS))
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMode {
    Inherit,
    ProjectRoot,
    NewWorktree,
    ExistingWorktree,
}

/// The `Workspace` object shared by `chat_launch` and `delegate_task`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkspaceInput {
    pub mode: WorkspaceMode,
    pub base_branch: Option<String>,
    pub branch_name: Option<String>,
    pub worktree_path: Option<String>,
}

impl Validate for WorkspaceInput {
    fn validate(&self) -> Result<(), ToolError> {
        check_opt_len("workspace.baseBranch", self.base_branch.as_deref(), 200)?;
        check_opt_len("workspace.branchName", self.branch_name.as_deref(), 200)?;
        check_opt_len(
            "workspace.worktreePath",
            self.worktree_path.as_deref(),
            4096,
        )
    }
}

// ── schema fragments ───────────────────────────────────────────────────────

#[must_use]
pub(crate) fn id_schema(description: &str) -> Value {
    json!({ "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,64}$", "description": description })
}

#[must_use]
pub(crate) fn string_schema(max: usize, description: &str) -> Value {
    json!({ "type": "string", "maxLength": max, "description": description })
}

#[must_use]
pub(crate) fn text_schema(description: &str) -> Value {
    json!({ "type": "string", "minLength": 1, "maxLength": TEXT_MAX, "description": description })
}

#[must_use]
pub(crate) fn permission_mode_schema() -> Value {
    json!({
        "enum": ["default", "acceptEdits", "auto", "yolo"],
        "description": "Permission mode for the child; never exceeds the caller's effective \
            privilege (see capabilities). Omit it to inherit the caller's mode, clamped to \
            what the target adapter supports. Set it only to restrict the child on purpose, \
            or when the user asks."
    })
}

#[must_use]
pub(crate) fn timeout_schema(description: &str) -> Value {
    json!({
        "type": "integer", "minimum": MIN_WAIT_MS, "maximum": MAX_WAIT_MS,
        "description": description
    })
}

#[must_use]
pub(crate) fn workspace_schema(modes: &[&str], description: &str) -> Value {
    json!({
        "type": "object",
        "description": description,
        "properties": {
            "mode": { "enum": modes },
            "baseBranch": { "type": "string", "maxLength": 200 },
            "branchName": { "type": "string", "maxLength": 200 },
            "worktreePath": { "type": "string", "maxLength": 4096 }
        },
        "required": ["mode"],
        "additionalProperties": false
    })
}

/// A closed object schema; `required` lists the mandatory properties.
#[must_use]
pub(crate) fn object_schema(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false
    })
}

#[cfg(test)]
pub(crate) mod golden {
    //! Golden-test helpers: a tool's schema and its serde struct must accept
    //! the same property set.
    use std::collections::BTreeSet;

    use serde_json::Value;

    pub(crate) fn schema_properties(schema: &Value) -> BTreeSet<String> {
        schema["properties"]
            .as_object()
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    }

    pub(crate) fn fixture_keys(fixture: &Value) -> BTreeSet<String> {
        fixture
            .as_object()
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_follow_the_identifier_rule() {
        assert!(check_id("chatId", "abc_DEF-123").is_ok());
        assert!(check_id("chatId", "").is_err());
        assert!(check_id("chatId", "a/b").is_err());
        assert!(check_id("chatId", &"a".repeat(65)).is_err());
    }

    #[test]
    fn lengths_count_characters() {
        assert!(check_len("title", "héllo", 1, 5).is_ok());
        assert!(check_len("title", "", 1, 5).is_err());
        assert!(check_timeout("timeoutMs", Some(999)).is_err());
        assert!(check_timeout("timeoutMs", Some(MAX_WAIT_MS)).is_ok());
    }
}
