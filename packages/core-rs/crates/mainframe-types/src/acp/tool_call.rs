//! Tool calls: the `ToolCallUpdate` upsert/patch (schema: "Only `toolCallId`
//! is required. Other fields have patch semantics: omitted fields leave the
//! existing tool call value unchanged, `null` clears or unsets the value, and
//! concrete values replace the previous value") and its streamed-append
//! sibling `ToolCallContentChunk`. `ToolCallContent` carries the `content`
//! (block) and `diff` variants; `terminal` is an explicit deviation — the
//! facade declines the `terminal/*` client services a `terminalId` would
//! point into (spec Decision 16).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::content::ContentBlock;
use super::patch;

pub type ToolCallId = String;

/// Schema `ToolKind` — a tool taxonomy shared across ACP's whole agent
/// ecosystem (ACP-EVALUATION.md "What to borrow" #2), adopted verbatim in
/// place of Mainframe's ad hoc `explore`/`hidden`/`progress`/`subagent` split.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    Read,
    Edit,
    Delete,
    Move,
    Search,
    Execute,
    Think,
    Fetch,
    SwitchMode,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallLocation {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

/// Kind of file content represented by a diff change (schema `DiffFileType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffFileType {
    Text,
    Binary,
    Directory,
    Symlink,
}

/// Renderable patch text format (schema `DiffPatchFormat`) — `git_patch` is
/// the only ACP-defined value: `diff --git` sections in Git's `--patch` text
/// format with absolute paths and no commit metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffPatchFormat {
    GitPatch,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffPatch {
    pub format: DiffPatchFormat,
    pub text: String,
}

/// The `operation` discriminant of a [`DiffChange`] plus its path payload:
/// `add`/`delete`/`modify` carry `path` (schema `DiffPathChange`), `move`/
/// `copy` carry `oldPath` + `path` (schema `DiffPathPairChange`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum DiffOperation {
    Add { path: String },
    Delete { path: String },
    Modify { path: String },
    Move { old_path: String, path: String },
    Copy { old_path: String, path: String },
}

/// One file-level change described by a [`Diff`] (schema `DiffChange`):
/// "structured change metadata lets clients identify affected files and
/// operations without parsing the text patch".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffChange {
    #[serde(flatten)]
    pub operation: DiffOperation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_type: Option<DiffFileType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}

/// File changes produced by a tool call (schema `Diff`): `changes` is
/// authoritative for affected paths and operations; `patch` optionally
/// carries renderable text and MUST be consistent with `changes` (omitted
/// and `null` are equivalent — no patch text was provided).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub changes: Vec<DiffChange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch: Option<DiffPatch>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolCallContent {
    Content { content: ContentBlock },
    Diff(Diff),
}

/// Tool-call upsert/patch. Every field but `toolCallId` uses the
/// `Option<Option<T>>` double-Option pattern (`patch.rs`) so omitted, `null`,
/// and value-present are all distinguishable on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallUpdate {
    pub tool_call_id: ToolCallId,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub title: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub kind: Option<Option<ToolKind>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub status: Option<Option<ToolCallStatus>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub content: Option<Option<Vec<ToolCallContent>>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub locations: Option<Option<Vec<ToolCallLocation>>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub raw_input: Option<Option<Value>>,
    #[serde(default, skip_serializing_if = "patch::is_absent", with = "patch")]
    pub raw_output: Option<Option<Value>>,
    #[serde(
        default,
        skip_serializing_if = "patch::is_absent",
        with = "patch",
        rename = "_meta"
    )]
    pub meta: Option<Option<Value>>,
}

/// One appended item of tool-call content — the `tool_call_content_chunk`
/// `session/update` payload. Unlike `ToolCallUpdate.content` (a full-array
/// replace), this always appends one item to the tool call's existing
/// content.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallContentChunk {
    pub tool_call_id: ToolCallId,
    pub content: ToolCallContent,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn roundtrip(v: serde_json::Value) {
        let parsed: ToolCallContent = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), v);
    }

    #[test]
    fn diff_content_with_modify_change_and_patch_round_trips() {
        roundtrip(json!({
            "type": "diff",
            "changes": [
                { "operation": "modify", "path": "/w/src/a.ts", "fileType": "text" }
            ],
            "patch": {
                "format": "git_patch",
                "text": "diff --git /w/src/a.ts /w/src/a.ts\n"
            }
        }));
    }

    #[test]
    fn diff_move_change_carries_old_path_and_path() {
        roundtrip(json!({
            "type": "diff",
            "changes": [
                { "operation": "move", "oldPath": "/w/old.ts", "path": "/w/new.ts" }
            ]
        }));
    }

    #[test]
    fn diff_with_explicit_null_patch_deserializes_to_none() {
        let parsed: ToolCallContent = serde_json::from_value(json!({
            "type": "diff",
            "changes": [{ "operation": "add", "path": "/w/new.ts" }],
            "patch": null
        }))
        .unwrap();
        let ToolCallContent::Diff(diff) = &parsed else {
            panic!("expected diff variant");
        };
        assert_eq!(diff.patch, None);
    }
}
