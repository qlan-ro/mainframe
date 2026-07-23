//! B5 reconstruction for `rollout_reader::read_rollout_items`: turning a paired
//! `custom_tool_call`/`custom_tool_call_output` (apply_patch) or a
//! `function_call`/`function_call_output` tagged with an `mcp__*` namespace back
//! into a `FileChange`/`McpToolCall` item, plus the per-record-kind `handle_*`
//! dispatch functions themselves. Split out from `rollout_reader.rs`, which owns
//! the JSONL walk and the `pending_*` maps it threads through these handlers, to
//! keep both files under the 300-line ceiling.

use std::collections::HashMap;

use crate::item_types::{
    CommandExecutionItem, FileChange, FileChangeItem, McpToolCallItem, McpToolResult,
    PatchChangeKind, ThreadItem,
};
use crate::rollout_reader::RolloutPayload;

/// A `function_call` identified as an MCP call (`namespace` starts with
/// `mcp__`), stashed until its matching `function_call_output` arrives.
pub(crate) struct PendingMcp {
    pub server: String,
    pub tool: String,
    pub arguments: HashMap<String, serde_json::Value>,
}

/// Codex encodes MCP arguments as a JSON string; a malformed one is kept as raw
/// text under an `"arguments"` key rather than dropping the whole tool call —
/// mirrors `dynamic_tool_call_input` in `thread_item_render.rs`, which wraps
/// non-object argument values the same way.
pub(crate) fn mcp_arguments_map(raw: &str) -> HashMap<String, serde_json::Value> {
    let value =
        serde_json::from_str(raw).unwrap_or_else(|_| serde_json::Value::String(raw.to_string()));
    match value.as_object() {
        Some(map) => map.clone().into_iter().collect(),
        None => HashMap::from([("arguments".to_string(), value)]),
    }
}

/// The rollout only gives a raw output string, not the structured
/// `McpToolResult` a live MCP response carries — stash it as-is in `content`.
pub(crate) fn build_mcp_tool_call_item(call_id: &str, pending: PendingMcp, output: &str) -> ThreadItem {
    let result = McpToolResult {
        content: serde_json::Value::String(output.to_string()),
        structured_content: serde_json::Value::Null,
        meta: serde_json::Value::Null,
    };
    ThreadItem::McpToolCall(McpToolCallItem {
        id: call_id.to_string(),
        server: Some(pending.server),
        tool: pending.tool,
        arguments: pending.arguments,
        result: Some(result),
        error: None,
        status: "completed".to_string(),
        mcp_app_resource_uri: None,
        duration_ms: None,
    })
}

struct PatchFileBlock {
    path: String,
    kind: PatchChangeKind,
    diff: String,
}

/// Splits an `apply_patch` envelope on its `*** {Add|Update|Delete} File:`
/// headers; everything up to the next header (or `*** End Patch`) is that
/// file's diff/content block.
fn parse_apply_patch_envelope(input: &str) -> Vec<PatchFileBlock> {
    let mut blocks = Vec::new();
    let mut current: Option<(String, PatchChangeKind, Vec<&str>)> = None;
    for line in input.lines() {
        if let Some(path) = line.strip_prefix("*** Update File: ") {
            flush_patch_block(&mut blocks, &mut current);
            let kind = PatchChangeKind::Update { move_path: None };
            current = Some((path.to_string(), kind, Vec::new()));
        } else if let Some(path) = line.strip_prefix("*** Add File: ") {
            flush_patch_block(&mut blocks, &mut current);
            current = Some((path.to_string(), PatchChangeKind::Add, Vec::new()));
        } else if let Some(path) = line.strip_prefix("*** Delete File: ") {
            flush_patch_block(&mut blocks, &mut current);
            current = Some((path.to_string(), PatchChangeKind::Delete, Vec::new()));
        } else if line == "*** End Patch" {
            flush_patch_block(&mut blocks, &mut current);
        } else if let Some((_, _, body)) = current.as_mut() {
            body.push(line);
        }
    }
    flush_patch_block(&mut blocks, &mut current);
    blocks
}

fn flush_patch_block(
    blocks: &mut Vec<PatchFileBlock>,
    current: &mut Option<(String, PatchChangeKind, Vec<&str>)>,
) {
    if let Some((path, kind, body)) = current.take() {
        blocks.push(PatchFileBlock {
            path,
            kind,
            diff: body.join("\n"),
        });
    }
}

/// Mirrors `rollout_reader::parse_rollout_output`'s exit-code scan but against
/// apply_patch's own header shape (`Exit code: N`, not `Process exited with
/// code N`), plus the textual success marker Codex also emits.
fn custom_tool_call_succeeded(output: &str) -> bool {
    let exit_zero = output
        .lines()
        .find_map(|l| l.strip_prefix("Exit code: "))
        .and_then(|rest| rest.trim().parse::<i64>().ok())
        .map(|code| code == 0)
        .unwrap_or(false);
    exit_zero || output.contains("Success. Updated the following files:")
}

pub(crate) fn build_file_change_item(call_id: &str, input: &str, output: &str) -> ThreadItem {
    let changes = parse_apply_patch_envelope(input)
        .into_iter()
        .map(|b| FileChange {
            path: b.path,
            kind: b.kind,
            diff: b.diff,
        })
        .collect();
    let status = if custom_tool_call_succeeded(output) {
        "completed"
    } else {
        "failed"
    };
    ThreadItem::FileChange(FileChangeItem {
        id: call_id.to_string(),
        changes,
        status: status.to_string(),
    })
}

/// Stashes an `exec_command` call's shell command, or an MCP call's
/// server/tool/arguments, keyed by `call_id` for the matching output below.
/// Anything else (update_plan, write_stdin, collaboration's
/// spawnAgent/wait/sendMessage) is handled elsewhere or genuinely out of scope
/// here — its call_id stays unregistered so the matching output is silently
/// ignored, unchanged from before B5.
pub(crate) fn handle_function_call(
    p: &RolloutPayload,
    pending_exec: &mut HashMap<String, String>,
    pending_mcp: &mut HashMap<String, PendingMcp>,
) {
    if p.name.as_deref() == Some("exec_command") {
        if let (Some(call_id), Some(arguments)) = (&p.call_id, &p.arguments)
            && let Ok(args) = serde_json::from_str::<serde_json::Value>(arguments)
            && let Some(cmd) = args.get("cmd").and_then(|v| v.as_str())
        {
            pending_exec.insert(call_id.clone(), cmd.to_string());
        }
        return;
    }
    if let (Some(call_id), Some(name), Some(server)) = (
        &p.call_id,
        &p.name,
        p.namespace.as_deref().and_then(|ns| ns.strip_prefix("mcp__")),
    ) {
        let arguments = mcp_arguments_map(p.arguments.as_deref().unwrap_or(""));
        pending_mcp.insert(
            call_id.clone(),
            PendingMcp {
                server: server.to_string(),
                tool: name.clone(),
                arguments,
            },
        );
    }
}

pub(crate) fn handle_function_call_output(
    p: &RolloutPayload,
    pending_exec: &mut HashMap<String, String>,
    pending_mcp: &mut HashMap<String, PendingMcp>,
    items: &mut Vec<ThreadItem>,
) {
    let Some(call_id) = &p.call_id else { return };
    let output = p.output.as_deref().unwrap_or("");
    if let Some(command) = pending_exec.remove(call_id) {
        let (exit_code, output) = parse_rollout_output(output);
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
    } else if let Some(pending) = pending_mcp.remove(call_id) {
        items.push(build_mcp_tool_call_item(call_id, pending, output));
    }
}

pub(crate) fn handle_custom_tool_call(
    p: &RolloutPayload,
    pending_patch: &mut HashMap<String, String>,
) {
    if p.name.as_deref() == Some("apply_patch")
        && let (Some(call_id), Some(input)) = (&p.call_id, &p.input)
    {
        pending_patch.insert(call_id.clone(), input.clone());
    }
}

pub(crate) fn handle_custom_tool_call_output(
    p: &RolloutPayload,
    pending_patch: &mut HashMap<String, String>,
    items: &mut Vec<ThreadItem>,
) {
    let Some(call_id) = &p.call_id else { return };
    let Some(input) = pending_patch.remove(call_id) else {
        return;
    };
    let output = p.output.as_deref().unwrap_or("");
    items.push(build_file_change_item(call_id, &input, output));
}

/// Parse Codex's function_call_output payload. The string starts with a header
/// (`Chunk ID`, `Wall time`, `Process exited with code N`, ...`Output:\n<output>`).
/// Extract the exit code and strip the header. Moved here (from
/// `rollout_reader.rs`) alongside the other pure record-parsing helpers to keep
/// that file under the 300-line ceiling.
pub(crate) fn parse_rollout_output(raw: &str) -> (i64, String) {
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
