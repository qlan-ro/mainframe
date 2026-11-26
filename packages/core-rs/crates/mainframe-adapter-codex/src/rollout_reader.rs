//! Reconstructs Codex rollout items, including child-thread tool calls omitted by thread/read.
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::item_types::{AgentMessageItem, ReasoningItem, ThreadItem, UserMessageItem};
use crate::rollout_fork::forked_child_start_line;
use crate::rollout_reconstruct::{
    PendingMcp, handle_custom_tool_call, handle_custom_tool_call_output, handle_function_call,
    handle_function_call_output,
};

/// `custom_tool_call_output.output` on every record kind except the modern
/// "unified exec" tool is a plain string; unified exec writes an array of
/// `{"type":"input_text","text":…}` blocks instead. `#[serde(untagged)]` picks
/// whichever shape the payload actually has.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(crate) enum RolloutOutput {
    Text(String),
    Blocks(Vec<RolloutContent>),
}

impl RolloutOutput {
    pub(crate) fn as_text(&self) -> String {
        match self {
            RolloutOutput::Text(s) => s.clone(),
            RolloutOutput::Blocks(blocks) => blocks.iter().filter_map(|b| b.text.clone()).collect(),
        }
    }
}

/// Only paths inside `~/.codex/sessions` (or its sibling `archived_sessions`)
/// are allowed — `rollout_path` comes from an externally-owned SQLite DB so we
/// treat it as untrusted input.
fn default_sessions_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex").join("sessions"))
}

/// Codex moves an archived thread's rollout from `sessions/` to the sibling
/// `archived_sessions/` and repoints the state DB at it.
fn archived_sessions_root(sessions_root: &std::path::Path) -> Option<PathBuf> {
    Some(sessions_root.parent()?.join("archived_sessions"))
}

/// Injectable containment root — mirrors `transcript::CodexTranscriptDeps`, letting
/// tests point at a temp dir instead of the real `~/.codex/sessions`.
#[derive(Debug, Clone, Default)]
pub struct RolloutReaderDeps {
    pub sessions_root: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RolloutContent {
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
    pub(crate) output: Option<RolloutOutput>,
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
    payload: Option<serde_json::Value>,
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
            tracing::warn!(error = %err, rollout_path, "failed to read rollout file");
            return Vec::new();
        }
    };
    parse_rollout_lines(&raw)
}

/// Resolves symlinks, then enforces two invariants before we trust `rollout_path`
/// (untrusted input from an externally-owned SQLite DB): it must live inside
/// `~/.codex/sessions/` or `~/.codex/archived_sessions/`, and its filename must
/// embed `expected_thread_id`.
pub(crate) async fn resolve_rollout_path(
    rollout_path: &str,
    expected_thread_id: Option<&str>,
    deps: Option<&RolloutReaderDeps>,
) -> Option<PathBuf> {
    let resolved = match tokio::fs::canonicalize(rollout_path).await {
        Ok(p) => p,
        Err(err) => {
            tracing::warn!(error = %err, rollout_path, "rollout file not found");
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
    let mut allowed = vec![tokio::fs::canonicalize(&root).await.unwrap_or(root.clone())];
    if let Some(archived) = archived_sessions_root(&root) {
        allowed.push(tokio::fs::canonicalize(&archived).await.unwrap_or(archived));
    }
    if !allowed.iter().any(|root| resolved.starts_with(root)) {
        tracing::warn!(
            rollout_path,
            resolved = %resolved.display(),
            "rollout path outside ~/.codex sessions directories, refusing to read"
        );
        return None;
    }
    if let Some(expected) = expected_thread_id
        && !resolved.to_string_lossy().contains(expected)
    {
        tracing::warn!(
            rollout_path,
            expected_thread_id = expected,
            "rollout filename does not match thread id, refusing to read"
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
///
/// A `spawn_agent(fork_turns: "all")` child rollout opens with a copy of the
/// parent's own history — `forked_child_start_line`
/// skips that prefix so it doesn't leak into the child's nested card.
pub(crate) fn parse_rollout_lines(raw: &str) -> Vec<ThreadItem> {
    let lines: Vec<&str> = raw.lines().collect();
    let start = forked_child_start_line(&lines).unwrap_or(0);
    parse_response_items(&lines[start..], &mut 0, false)
}

pub(crate) fn parse_response_items(
    lines: &[&str],
    counter: &mut usize,
    prefer_user_events: bool,
) -> Vec<ThreadItem> {
    let mut items = Vec::new();
    let mut pending_exec = HashMap::new();
    let mut pending_mcp = HashMap::new();
    let mut pending_patch = HashMap::new();
    let mut pending_unified_exec = HashMap::new();
    for line in lines {
        let Ok(rec) = serde_json::from_str::<RolloutLine>(line) else {
            continue;
        };
        let Some(payload) = rec.payload else { continue };
        if prefer_user_events
            && rec.kind.as_deref() == Some("event_msg")
            && payload["type"] == "user_message"
        {
            items.push(ThreadItem::UserMessage(UserMessageItem {
                id: next_id(counter),
                client_id: payload["client_id"].as_str().map(str::to_owned),
                content: None,
                text: payload["message"].as_str().map(str::to_owned),
            }));
        } else if rec.kind.as_deref() == Some("response_item")
            && !(prefer_user_events && payload["role"] == "user")
            && let Ok(p) = serde_json::from_value::<RolloutPayload>(payload)
        {
            apply_rollout_payload(
                &p,
                counter,
                &mut pending_exec,
                &mut pending_mcp,
                &mut pending_patch,
                &mut pending_unified_exec,
                &mut items,
            );
        }
    }
    items
}

fn apply_rollout_payload(
    p: &RolloutPayload,
    counter: &mut usize,
    pending_exec: &mut HashMap<String, String>,
    pending_mcp: &mut HashMap<String, PendingMcp>,
    pending_patch: &mut HashMap<String, String>,
    pending_unified_exec: &mut HashMap<String, String>,
    items: &mut Vec<ThreadItem>,
) {
    match p.kind.as_deref() {
        Some("message") => handle_message(p, counter, items),
        Some("reasoning") => handle_reasoning(p, counter, items),
        Some("function_call") => handle_function_call(p, pending_exec, pending_mcp),
        Some("function_call_output") => {
            handle_function_call_output(p, pending_exec, pending_mcp, items);
        }
        Some("custom_tool_call") => handle_custom_tool_call(p, pending_patch, pending_unified_exec),
        Some("custom_tool_call_output") => {
            handle_custom_tool_call_output(p, pending_patch, pending_unified_exec, items);
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
            delivery: Default::default(),
            questions: Default::default(),
        })),
        Some("user") => items.push(ThreadItem::UserMessage(UserMessageItem {
            id: next_id(counter),
            client_id: None,
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
