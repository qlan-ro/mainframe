//! Ported from `packages/core/src/plugins/builtin/codex/rollout-reader.ts`.
//!
//! Parses a Codex rollout JSONL file into `ThreadItem`s. The rollout is the raw
//! per-thread session log Codex writes to
//! `~/.codex/sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl` — it contains every
//! ResponseItem the agent processed (function_call, function_call_output, message,
//! reasoning), unlike `thread/read` which filters child-thread `commandExecution`s
//! out. We only use it for SUB-AGENT child threads on history reload.
//!
//! B5 extends this beyond `exec_command`: sub-agent file edits arrive as a
//! `custom_tool_call`/`custom_tool_call_output` pair (`name: "apply_patch"`), and
//! MCP calls arrive as `function_call`/`function_call_output` tagged with a
//! `namespace` starting `mcp__`. The parsing/building logic for both (plus the
//! pre-existing exec-output parsing) lives in `rollout_reconstruct` to keep this
//! file under the 300-line ceiling.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;

use crate::item_types::{AgentMessageItem, ReasoningItem, ThreadItem, UserMessageItem};
use crate::rollout_reconstruct::{
    PendingMcp, handle_custom_tool_call, handle_custom_tool_call_output, handle_function_call,
    handle_function_call_output,
};

/// Only paths inside `~/.codex/sessions` are allowed — `rollout_path` comes from an
/// externally-owned SQLite DB so we treat it as untrusted input.
fn default_sessions_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex").join("sessions"))
}

/// Injectable containment root — mirrors `transcript::CodexTranscriptDeps`, letting
/// tests point at a temp dir instead of the real `~/.codex/sessions`.
#[derive(Debug, Clone, Default)]
pub struct RolloutReaderDeps {
    pub sessions_root: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct RolloutContent {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RolloutPayload {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    content: Option<Vec<RolloutContent>>,
    #[serde(default)]
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) arguments: Option<String>,
    #[serde(default)]
    pub(crate) call_id: Option<String>,
    #[serde(default)]
    pub(crate) output: Option<String>,
    #[serde(default)]
    summary: Option<Vec<RolloutContent>>,
    /// Present on MCP `function_call` records (e.g. `"mcp__testserver"`); absent
    /// (not just empty) on `exec_command` and other builtin tool calls.
    #[serde(default)]
    pub(crate) namespace: Option<String>,
    /// The apply_patch envelope on a `custom_tool_call` record.
    #[serde(default)]
    pub(crate) input: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RolloutLine {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    payload: Option<RolloutPayload>,
}

/// Read a rollout JSONL and return `ThreadItem`s in the same shape as
/// `thread/read`, but with `commandExecution`/`fileChange`/`mcpToolCall` items
/// reconstructed from the raw request/response record pairs.
pub async fn read_rollout_items(
    rollout_path: &str,
    expected_thread_id: Option<&str>,
    deps: Option<&RolloutReaderDeps>,
) -> Vec<ThreadItem> {
    let Some(resolved) = resolve_rollout_path(rollout_path, expected_thread_id, deps).await else {
        return Vec::new();
    };
    let raw = match tokio::fs::read_to_string(&resolved).await {
        Ok(s) => s,
        Err(err) => {
            tracing::warn!(module = "codex:rollout", err = %err, rollout_path, "codex: failed to read rollout file");
            return Vec::new();
        }
    };
    parse_rollout_lines(&raw)
}

/// Resolves symlinks, then enforces two invariants before we trust `rollout_path`
/// (untrusted input from an externally-owned SQLite DB): it must live inside
/// `~/.codex/sessions/`, and its filename must embed `expected_thread_id`.
async fn resolve_rollout_path(
    rollout_path: &str,
    expected_thread_id: Option<&str>,
    deps: Option<&RolloutReaderDeps>,
) -> Option<PathBuf> {
    let resolved = match tokio::fs::canonicalize(rollout_path).await {
        Ok(p) => p,
        Err(err) => {
            tracing::warn!(module = "codex:rollout", err = %err, rollout_path, "codex: rollout file not found");
            return None;
        }
    };
    let root = deps
        .and_then(|d| d.sessions_root.clone())
        .or_else(default_sessions_root)?;
    // `canonicalize` the root too — on macOS a tempdir (or `~`) path routes through a
    // `/var` -> `/private/var` symlink, so comparing it as-is against the already
    // resolved file path would spuriously fail containment. Fall back to the raw
    // root if it doesn't exist yet (e.g. tests asserting containment on `nope/`).
    let root = tokio::fs::canonicalize(&root).await.unwrap_or(root);
    if !resolved.starts_with(&root) {
        tracing::warn!(
            module = "codex:rollout",
            rollout_path,
            resolved = %resolved.display(),
            "codex: rollout path outside ~/.codex/sessions, refusing to read"
        );
        return None;
    }
    if let Some(expected) = expected_thread_id
        && !resolved.to_string_lossy().contains(expected)
    {
        tracing::warn!(
            module = "codex:rollout",
            rollout_path,
            expected_thread_id = expected,
            "codex: rollout filename does not match thread id, refusing to read"
        );
        return None;
    }
    Some(resolved)
}

/// Walks the JSONL, dispatching each `response_item` payload to its handler.
/// Each record kind gets its own pending map — call_id spaces from
/// exec_command, MCP function_calls, and apply_patch custom_tool_calls are not
/// guaranteed disjoint, and a bug in one pairing lifecycle must not be able to
/// steal or corrupt another kind's pending entry.
fn parse_rollout_lines(raw: &str) -> Vec<ThreadItem> {
    let mut items: Vec<ThreadItem> = Vec::new();
    let mut pending_exec: HashMap<String, String> = HashMap::new();
    let mut pending_mcp: HashMap<String, PendingMcp> = HashMap::new();
    let mut pending_patch: HashMap<String, String> = HashMap::new();
    let mut counter = 0usize;

    for line in raw.split('\n') {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(rec) = serde_json::from_str::<RolloutLine>(line) else {
            continue;
        };
        if rec.kind.as_deref() != Some("response_item") {
            continue;
        }
        let Some(p) = rec.payload else { continue };
        apply_rollout_payload(
            &p,
            &mut counter,
            &mut pending_exec,
            &mut pending_mcp,
            &mut pending_patch,
            &mut items,
        );
    }

    items
}

fn apply_rollout_payload(
    p: &RolloutPayload,
    counter: &mut usize,
    pending_exec: &mut HashMap<String, String>,
    pending_mcp: &mut HashMap<String, PendingMcp>,
    pending_patch: &mut HashMap<String, String>,
    items: &mut Vec<ThreadItem>,
) {
    match p.kind.as_deref() {
        Some("message") => handle_message(p, counter, items),
        Some("reasoning") => handle_reasoning(p, counter, items),
        Some("function_call") => handle_function_call(p, pending_exec, pending_mcp),
        Some("function_call_output") => {
            handle_function_call_output(p, pending_exec, pending_mcp, items);
        }
        Some("custom_tool_call") => handle_custom_tool_call(p, pending_patch),
        Some("custom_tool_call_output") => {
            handle_custom_tool_call_output(p, pending_patch, items);
        }
        _ => {}
    }
}

fn handle_message(p: &RolloutPayload, counter: &mut usize, items: &mut Vec<ThreadItem>) {
    let Some(content) = &p.content else { return };
    let text: String = content
        .iter()
        .filter(|c| matches!(c.kind.as_deref(), Some("output_text") | Some("input_text")))
        .map(|c| c.text.clone().unwrap_or_default())
        .collect();
    if text.is_empty() {
        return;
    }
    match p.role.as_deref() {
        Some("assistant") => items.push(ThreadItem::AgentMessage(AgentMessageItem {
            id: next_id(counter),
            text,
            phase: None,
        })),
        Some("user") => items.push(ThreadItem::UserMessage(UserMessageItem {
            id: next_id(counter),
            content: None,
            text: Some(text),
        })),
        _ => {}
    }
}

fn handle_reasoning(p: &RolloutPayload, counter: &mut usize, items: &mut Vec<ThreadItem>) {
    let Some(summary_blocks) = &p.summary else {
        return;
    };
    let summary: Vec<String> = summary_blocks
        .iter()
        .map(|s| s.text.clone().unwrap_or_default())
        .filter(|t| !t.is_empty())
        .collect();
    if summary.is_empty() {
        return;
    }
    items.push(ThreadItem::Reasoning(ReasoningItem {
        id: next_id(counter),
        summary,
        content: Vec::new(),
    }));
}

fn next_id(counter: &mut usize) -> String {
    let id = format!("rollout-{counter}");
    *counter += 1;
    id
}

// PORT STATUS: src/plugins/builtin/codex/rollout-reader.ts (167 lines)
// confidence: high
// todos: 0
// notes: async tokio fs (canonicalize/read_to_string) mirrors the TS realpath +
// notes: readFile. SESSIONS_ROOT containment check uses PathBuf::starts_with on
// notes: the canonicalized path. B5 (2026-07-24) added apply_patch
// notes: (custom_tool_call/custom_tool_call_output) and MCP (function_call with
// notes: an mcp__* namespace) reconstruction; parse_rollout_output and its 3
// notes: unit tests moved to rollout_reconstruct.rs alongside the new pure
// notes: parsing helpers to keep this file under the 300-line ceiling.
