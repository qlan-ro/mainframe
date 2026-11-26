use crate::rollout_fork::forked_child_start_line;
use crate::rollout_reader::{RolloutReaderDeps, parse_response_items, resolve_rollout_path};
use crate::types::{ThreadItem, ThreadReadTurn};
use mainframe_types::chat::ChatMessage;
use serde_json::Value;
use std::collections::HashMap;

pub(crate) async fn read_rollout_history(
    path: &str,
    thread: &str,
    deps: Option<&RolloutReaderDeps>,
) -> Option<Vec<ChatMessage>> {
    let path = resolve_rollout_path(path, Some(thread), deps).await?;
    let raw = tokio::fs::read_to_string(path).await.ok()?;
    let messages = convert_rollout(&raw, thread);
    (!messages.is_empty()).then_some(messages)
}

fn convert_rollout(raw: &str, thread: &str) -> Vec<ChatMessage> {
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

fn convert_group(
    items: Vec<ThreadItem>,
    turn: Option<String>,
    status: &str,
    thread: &str,
) -> Vec<ChatMessage> {
    let children = HashMap::new();
    let agents = HashMap::new();
    match turn {
        Some(id) => crate::presentation_history::convert_turns(
            &[ThreadReadTurn {
                id,
                status: status.into(),
                items,
                timing: Default::default(),
            }],
            thread,
            &children,
            &agents,
        ),
        None => crate::history_convert::convert_thread_items(&items, thread, &children, &agents),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn rollout_steer_keeps_turn_membership_and_delivery_identity() {
        let raw = r#"
{"type":"event_msg","payload":{"type":"task_started","turn_id":"first"}}
{"type":"event_msg","payload":{"type":"user_message","message":"initial","client_id":"initial-id"}}
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"initial"}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"working"}]}}
{"type":"event_msg","payload":{"type":"user_message","message":"steer","client_id":"steer-id"}}
{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}}
{"type":"event_msg","payload":{"type":"task_complete","turn_id":"first"}}
{"type":"event_msg","payload":{"type":"task_started","turn_id":"second"}}
{"type":"event_msg","payload":{"type":"user_message","message":"next","client_id":"next-id"}}
"#;
        let messages = super::convert_rollout(raw, "thread");
        let users: Vec<_> = messages
            .iter()
            .filter_map(|message| message.metadata.as_ref())
            .filter(|metadata| metadata.contains_key("providerInputUuid"))
            .collect();
        assert_eq!(users.len(), 3);
        assert_eq!(users[1]["providerInputUuid"], "steer-id");
        assert_eq!(users[1]["steered"], true);
        assert!(!users[2].contains_key("steered"));
    }
}
