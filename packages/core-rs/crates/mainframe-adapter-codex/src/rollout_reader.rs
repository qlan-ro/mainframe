//! Ported from `packages/core/src/plugins/builtin/codex/rollout-reader.ts`.
//!
//! Parses a Codex rollout JSONL file into `ThreadItem`s. The rollout is the raw
//! per-thread session log Codex writes to
//! `~/.codex/sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl` — it contains every
//! ResponseItem the agent processed (function_call, function_call_output, message,
//! reasoning), unlike `thread/read` which filters child-thread `commandExecution`s
//! out. We only use it for SUB-AGENT child threads on history reload.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;

use crate::item_types::{
    AgentMessageItem, CommandExecutionItem, ReasoningItem, ThreadItem, UserMessageItem,
};

/// Only paths inside `~/.codex/sessions` are allowed — `rollout_path` comes from an
/// externally-owned SQLite DB so we treat it as untrusted input.
fn sessions_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex").join("sessions"))
}

#[derive(Debug, Deserialize)]
struct RolloutContent {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RolloutPayload {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    content: Option<Vec<RolloutContent>>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
    #[serde(default)]
    call_id: Option<String>,
    #[serde(default)]
    output: Option<String>,
    #[serde(default)]
    summary: Option<Vec<RolloutContent>>,
}

#[derive(Debug, Deserialize)]
struct RolloutLine {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    payload: Option<RolloutPayload>,
}

/// Read a rollout JSONL and return `ThreadItem`s in the same shape as
/// `thread/read`, but with `commandExecution` items reconstructed from the raw
/// `function_call` / `function_call_output` records.
pub async fn read_rollout_items(
    rollout_path: &str,
    expected_thread_id: Option<&str>,
) -> Vec<ThreadItem> {
    // Resolve symlinks and ensure the file lives inside ~/.codex/sessions/.
    let resolved = match tokio::fs::canonicalize(rollout_path).await {
        Ok(p) => p,
        Err(err) => {
            tracing::warn!(module = "codex:rollout", err = %err, rollout_path, "codex: rollout file not found");
            return Vec::new();
        }
    };
    let Some(root) = sessions_root() else {
        return Vec::new();
    };
    if !resolved.starts_with(&root) {
        tracing::warn!(
            module = "codex:rollout",
            rollout_path,
            resolved = %resolved.display(),
            "codex: rollout path outside ~/.codex/sessions, refusing to read"
        );
        return Vec::new();
    }
    // Sanity: the rollout filename should embed the thread id.
    if let Some(expected) = expected_thread_id
        && !resolved.to_string_lossy().contains(expected)
    {
        tracing::warn!(
            module = "codex:rollout",
            rollout_path,
            expected_thread_id = expected,
            "codex: rollout filename does not match thread id, refusing to read"
        );
        return Vec::new();
    }

    let raw = match tokio::fs::read_to_string(&resolved).await {
        Ok(s) => s,
        Err(err) => {
            tracing::warn!(module = "codex:rollout", err = %err, rollout_path, "codex: failed to read rollout file");
            return Vec::new();
        }
    };

    let mut items: Vec<ThreadItem> = Vec::new();
    // Track function_call records by call_id so we can pair them with outputs.
    let mut pending_exec: HashMap<String, String> = HashMap::new();
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
        let ptype = p.kind.as_deref();

        // ─── Messages ──────────────────────────────────────────────────────────
        if ptype == Some("message")
            && let Some(content) = &p.content
        {
            let text: String = content
                .iter()
                .filter(|c| matches!(c.kind.as_deref(), Some("output_text") | Some("input_text")))
                .map(|c| c.text.clone().unwrap_or_default())
                .collect();
            if text.is_empty() {
                continue;
            }
            match p.role.as_deref() {
                Some("assistant") => {
                    let id = next_id(&mut counter);
                    items.push(ThreadItem::AgentMessage(AgentMessageItem {
                        id,
                        text,
                        phase: None,
                    }));
                }
                Some("user") => {
                    let id = next_id(&mut counter);
                    items.push(ThreadItem::UserMessage(UserMessageItem {
                        id,
                        content: None,
                        text: Some(text),
                    }));
                }
                _ => {}
            }
            continue;
        }

        // ─── Reasoning ─────────────────────────────────────────────────────────
        if ptype == Some("reasoning")
            && let Some(summary_blocks) = &p.summary
        {
            let summary: Vec<String> = summary_blocks
                .iter()
                .map(|s| s.text.clone().unwrap_or_default())
                .filter(|t| !t.is_empty())
                .collect();
            if summary.is_empty() {
                continue;
            }
            let id = next_id(&mut counter);
            items.push(ThreadItem::Reasoning(ReasoningItem {
                id,
                summary,
                content: Vec::new(),
            }));
            continue;
        }

        // ─── Bash exec (function_call → exec_command) ──────────────────────────
        if ptype == Some("function_call") && p.name.as_deref() == Some("exec_command") {
            if let (Some(call_id), Some(arguments)) = (&p.call_id, &p.arguments)
                && let Ok(args) = serde_json::from_str::<serde_json::Value>(arguments)
                && let Some(cmd) = args.get("cmd").and_then(|v| v.as_str())
            {
                pending_exec.insert(call_id.clone(), cmd.to_string());
            }
            continue;
        }

        if ptype == Some("function_call_output")
            && let Some(call_id) = &p.call_id
        {
            let Some(command) = pending_exec.remove(call_id) else {
                continue;
            };
            let (exit_code, output) = parse_rollout_output(p.output.as_deref().unwrap_or(""));
            items.push(ThreadItem::CommandExecution(CommandExecutionItem {
                id: call_id.clone(),
                command,
                aggregated_output: output,
                exit_code: Some(exit_code),
                status: if exit_code == 0 {
                    "completed".to_string()
                } else {
                    "failed".to_string()
                },
            }));
            continue;
        }
    }

    items
}

fn next_id(counter: &mut usize) -> String {
    let id = format!("rollout-{counter}");
    *counter += 1;
    id
}

/// Parse Codex's function_call_output payload. The string starts with a header
/// (`Chunk ID`, `Wall time`, `Process exited with code N`, ...`Output:\n<output>`).
/// Extract the exit code and strip the header.
fn parse_rollout_output(raw: &str) -> (i64, String) {
    let exit_code = raw
        .lines()
        .find_map(|l| l.strip_prefix("Process exited with code "))
        .and_then(|rest| {
            let digits: String = rest
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '-')
                .collect();
            digits.parse::<i64>().ok()
        })
        .unwrap_or(0);
    let marker = "\nOutput:\n";
    let output = match raw.find(marker) {
        Some(idx) => raw[idx + marker.len()..].to_string(),
        None => raw.to_string(),
    };
    (exit_code, output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rollout_output_extracts_exit_and_strips_header() {
        let raw = "Chunk ID: f71ecd\nWall time: 0.0 seconds\nProcess exited with code 0\nOutput:\nhello world";
        let (code, out) = parse_rollout_output(raw);
        assert_eq!(code, 0);
        assert_eq!(out, "hello world");
    }

    #[test]
    fn parse_rollout_output_nonzero_exit() {
        let raw = "Process exited with code 127\nOutput:\nnot found";
        let (code, out) = parse_rollout_output(raw);
        assert_eq!(code, 127);
        assert_eq!(out, "not found");
    }

    #[test]
    fn parse_rollout_output_no_marker_returns_raw() {
        let raw = "bare output";
        let (code, out) = parse_rollout_output(raw);
        assert_eq!(code, 0);
        assert_eq!(out, "bare output");
    }
}

// PORT STATUS: src/plugins/builtin/codex/rollout-reader.ts (167 lines)
// confidence: high
// todos: 0
// notes: async tokio fs (canonicalize/read_to_string) mirrors the TS realpath +
// notes: readFile. The `^Process exited with code (-?\d+)` regex is hand-rolled
// notes: (no regex crate) as a line-prefix scan. SESSIONS_ROOT containment check
// notes: uses PathBuf::starts_with on the canonicalized path. Added 3 unit tests
// notes: for parse_rollout_output (no TS test file exists for this module).
