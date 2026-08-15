//! Reconstructs a `CommandExecution` item from a modern Codex "unified exec"
//! tool call's rollout pair — a `custom_tool_call` (`name: "exec"`) whose
//! `input` is a JS snippet wrapping `tools.exec_command({...})`, rather than
//! the plain JSON args string `exec_command`'s own `function_call` record
//! carries, paired with a `custom_tool_call_output`. Split from
//! `rollout_reconstruct.rs` to keep both files under the 300-line ceiling
//! (todo #339 task 16).

use std::collections::HashMap;

use serde_json::Value;

use crate::item_types::{CommandExecutionItem, ThreadItem};
use crate::rollout_reader::RolloutPayload;

const MARKER: &str = "tools.exec_command(";

/// Stashes a unified-exec call's shell command, keyed by `call_id`, for the
/// matching output in [`build_unified_exec_item`]. A parse failure logs and
/// leaves the call_id unregistered, so its output is silently ignored rather
/// than fabricating a command.
pub(crate) fn register_unified_exec(p: &RolloutPayload, pending: &mut HashMap<String, String>) {
    if p.name.as_deref() != Some("exec") {
        return;
    }
    let (Some(call_id), Some(input)) = (&p.call_id, &p.input) else {
        return;
    };
    match extract_unified_exec_command(input) {
        Some(command) => {
            pending.insert(call_id.clone(), command);
        }
        None => {
            tracing::debug!(
                module = "codex:rollout",
                call_id,
                "codex: failed to parse unified exec command from rollout input, skipping pair"
            );
        }
    }
}

/// Consumes a pending unified-exec command and its output into a
/// `CommandExecution` item. The output carries no exit code — unified exec
/// never reports one — so `exit_code` is `None`; `is_exec_error(None)` is
/// `false`, which the ungated history scan (`history_convert.rs`) reads as a
/// successful command.
pub(crate) fn build_unified_exec_item(
    call_id: &str,
    pending: &mut HashMap<String, String>,
    output: String,
) -> Option<ThreadItem> {
    let command = pending.remove(call_id)?;
    Some(ThreadItem::CommandExecution(CommandExecutionItem {
        id: call_id.to_string(),
        command,
        aggregated_output: output,
        exit_code: None,
        status: "completed".to_string(),
    }))
}

/// Extract the `cmd` field from `tools.exec_command({...})`, brace-matching
/// the JSON object literal that follows the marker. Returns `None` on any
/// parse failure.
fn extract_unified_exec_command(input: &str) -> Option<String> {
    let start = input.find(MARKER)? + MARKER.len();
    let json_str = brace_match(&input[start..])?;
    let value: Value = serde_json::from_str(json_str).ok()?;
    command_text(value.get("cmd")?)
}

/// Returns the substring from the first `{` through its matching `}`,
/// tracking string literals so a `}` inside a quoted value doesn't end the
/// match early.
fn brace_match(text: &str) -> Option<&str> {
    let open = text.find('{')?;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (i, c) in text.char_indices().skip(open) {
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[open..i + c.len_utf8()]);
                }
            }
            _ => {}
        }
    }
    None
}

/// `cmd` arrives either as a plain string or as an argv array; the array form
/// is joined with a single space to match the shape `is_pr_create_command`
/// expects.
fn command_text(cmd: &Value) -> Option<String> {
    if let Some(s) = cmd.as_str() {
        return Some(s.to_string());
    }
    let parts: Vec<&str> = cmd.as_array()?.iter().filter_map(Value::as_str).collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_a_string_command() {
        let inner = json!({"cmd": "gh pr create --title x", "workdir": "/tmp"}).to_string();
        let input = format!("const r = await tools.exec_command({inner}); text(r.output);");
        assert_eq!(
            extract_unified_exec_command(&input),
            Some("gh pr create --title x".to_string())
        );
    }

    #[test]
    fn joins_an_array_command_with_spaces() {
        let inner =
            json!({"cmd": ["gh", "pr", "create", "--title", "x"], "workdir": "/tmp"}).to_string();
        let input = format!("const r = await tools.exec_command({inner}); text(r.output);");
        assert_eq!(
            extract_unified_exec_command(&input),
            Some("gh pr create --title x".to_string())
        );
    }

    #[test]
    fn returns_none_for_a_malformed_wrapper() {
        assert_eq!(
            extract_unified_exec_command("not a parseable exec_command wrapper"),
            None
        );
    }

    #[test]
    fn brace_matches_past_a_quoted_brace() {
        let inner = json!({"cmd": "echo '{'", "workdir": "/tmp"}).to_string();
        let input = format!("const r = await tools.exec_command({inner}); text(r.output);");
        assert_eq!(
            extract_unified_exec_command(&input),
            Some("echo '{'".to_string())
        );
    }
}
