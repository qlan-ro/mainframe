//! Reference implementation and rollout line builders shared by the parity
//! tests and the large-file bench.
#![allow(clippy::unwrap_used, reason = "Test fixtures")]

use super::super::*;
use crate::rollout_fork::forked_child_start_line;
use serde_json::json;

/// The pre-change implementation, kept verbatim as the reference.
pub(super) fn convert_rollout_whole_string(raw: &str, thread: &str) -> Vec<ChatMessage> {
    let lines: Vec<_> = raw.lines().collect();
    let start = forked_child_start_line(&lines).unwrap_or(0);
    let mut counter = 0;
    let mut groups = Vec::new();
    let mut group_start = start;
    let mut turn = None;
    let mut has_users = false;
    for (index, line) in lines.iter().enumerate().skip(start) {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if record["type"] != "event_msg" {
            continue;
        }
        let payload = &record["payload"];
        match payload["type"].as_str() {
            Some("task_started" | "turn_started") => {
                groups.push((group_start..index, turn.take(), "inProgress", has_users));
                group_start = index;
                turn = payload["turn_id"].as_str().map(str::to_owned);
                has_users = false;
            }
            Some("user_message") => has_users = true,
            Some("task_complete" | "turn_complete" | "turn_aborted")
                if turn.as_deref().is_some_and(|id| payload["turn_id"] == id) =>
            {
                let status = if payload["type"] == "turn_aborted" {
                    "interrupted"
                } else {
                    "completed"
                };
                groups.push((group_start..index, turn.take(), status, has_users));
                group_start = index + 1;
                has_users = false;
            }
            _ => {}
        }
    }
    groups.push((group_start..lines.len(), turn, "inProgress", has_users));
    groups
        .into_iter()
        .flat_map(|(range, turn, status, has_users)| {
            let items = parse_response_items(&lines[range], &mut counter, has_users);
            convert_group(items, turn, status, thread)
        })
        .collect()
}

pub(super) fn line(kind: &str, payload: serde_json::Value) -> String {
    json!({"type": kind, "payload": payload}).to_string()
}

pub(super) fn event(kind: &str, turn: &str) -> String {
    line("event_msg", json!({"type": kind, "turn_id": turn}))
}

pub(super) fn user(text: &str) -> String {
    line(
        "event_msg",
        json!({"type": "user_message", "message": text}),
    )
}

pub(super) fn exec(call_id: &str, cmd: &str) -> String {
    let arguments = json!({"cmd": cmd}).to_string();
    line(
        "response_item",
        json!({"type": "function_call", "name": "exec_command", "call_id": call_id,
               "arguments": arguments}),
    )
}

pub(super) fn exec_output(call_id: &str, output: &str) -> String {
    line(
        "response_item",
        json!({"type": "function_call_output", "call_id": call_id,
               "output": format!("Chunk ID: 1\nProcess exited with code 0\nOutput:\n{output}")}),
    )
}

pub(super) fn assistant(text: &str) -> String {
    line(
        "response_item",
        json!({"type": "message", "role": "assistant",
               "content": [{"type": "output_text", "text": text}]}),
    )
}

pub(super) fn pr_turn(turn: &str, call: &str, pr: u32, pad: usize) -> Vec<String> {
    vec![
        event("task_started", turn),
        user("go"),
        exec(call, "gh pr create --title x"),
        exec_output(
            call,
            &format!(
                "{}https://github.com/acme/repo/pull/{pr}\n",
                "x".repeat(pad)
            ),
        ),
        assistant("done"),
        event("task_complete", turn),
    ]
}
