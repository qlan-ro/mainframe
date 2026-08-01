//! Moved out of `session.rs` (task 3, todo #247) to keep that file smaller.
//! `load_history_inner` — the loadHistory temp-app-server + thread/read
//! recursion, unchanged.

use std::collections::HashMap;
use std::sync::Arc;

use mainframe_adapter_api::AdapterError;
use mainframe_types::chat::ChatMessage;
use serde_json::json;

use crate::history::convert_thread_items;
use crate::jsonrpc::JsonRpcClient;
use crate::rollout_reader::read_rollout_items;
use crate::session::de;
use crate::thread_registry::{AgentMetadata, lookup_agent_metadata};
use crate::types::{ThreadItem, ThreadReadResult};

pub(crate) async fn load_history_inner(
    temp: &Arc<JsonRpcClient>,
    resume_thread_id: &str,
    project_path: &str,
) -> Result<Vec<ChatMessage>, AdapterError> {
    let _ = project_path;
    let read: ThreadReadResult = de(temp
        .request(
            "thread/read",
            Some(json!({ "threadId": resume_thread_id, "includeTurns": true })),
        )
        .await
        .map_err(|e| AdapterError::Message(e.0))?)?;

    let all_items: Vec<ThreadItem> = read
        .thread
        .turns
        .unwrap_or_default()
        .into_iter()
        .flat_map(|t| t.items)
        .collect();

    let child_thread_ids = collect_child_thread_ids(&all_items);

    let agent_meta_by_thread: HashMap<String, AgentMetadata> = if child_thread_ids.is_empty() {
        HashMap::new()
    } else {
        lookup_agent_metadata(&child_thread_ids)
    };

    let mut child_items_by_thread: HashMap<String, Vec<ThreadItem>> = HashMap::new();
    for child_id in &child_thread_ids {
        // Prefer the raw rollout JSONL — it has function_call records (bash) that
        // thread/read strips. Fall back to thread/read if unavailable.
        let rollout_path = agent_meta_by_thread
            .get(child_id)
            .and_then(|m| m.rollout_path.clone());
        if let Some(rollout_path) = rollout_path {
            let items = read_rollout_items(&rollout_path, Some(child_id), None).await;
            if !items.is_empty() {
                child_items_by_thread.insert(child_id.clone(), items);
                continue;
            }
        }
        match temp
            .request(
                "thread/read",
                Some(json!({ "threadId": child_id, "includeTurns": true })),
            )
            .await
        {
            Ok(v) => {
                let child_result: ThreadReadResult = de(v)?;
                let items: Vec<ThreadItem> = child_result
                    .thread
                    .turns
                    .unwrap_or_default()
                    .into_iter()
                    .flat_map(|t| t.items)
                    .collect();
                child_items_by_thread.insert(child_id.clone(), items);
            }
            Err(err) => {
                tracing::warn!(module = "codex:session", err = %err.0, child_id, "codex: failed to read child thread, nesting will be skipped");
            }
        }
    }

    Ok(convert_thread_items(
        &all_items,
        resume_thread_id,
        &child_items_by_thread,
        &agent_meta_by_thread,
    ))
}

/// Child thread ids to fetch and nest, from both naming routes (todo #247
/// task 21): a `subAgentActivity` ping of any kind, and a `wait`'s
/// `receiverThreadIds` (the legacy route). Deduped and order-preserving.
fn collect_child_thread_ids(all_items: &[ThreadItem]) -> Vec<String> {
    let mut child_thread_ids: Vec<String> = Vec::new();
    let mut push_unique = |id: &str| {
        if !child_thread_ids.iter().any(|existing| existing == id) {
            child_thread_ids.push(id.to_string());
        }
    };
    for item in all_items {
        match item {
            ThreadItem::SubAgentActivity(a) => push_unique(&a.agent_thread_id),
            ThreadItem::CollabAgentToolCall(c) if c.tool == "wait" => {
                for id in c.receiver_thread_ids.iter().flatten() {
                    push_unique(id);
                }
            }
            _ => {}
        }
    }
    child_thread_ids
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::collect_child_thread_ids;
    use crate::types::ThreadItem;

    fn items(v: serde_json::Value) -> Vec<ThreadItem> {
        serde_json::from_value(v).expect("items parse")
    }

    #[test]
    fn collects_the_child_thread_id_from_a_started_activity_ping() {
        let all = items(json!([
            { "id": "s1", "type": "subAgentActivity", "kind": "started", "agentThreadId": "child-1", "agentPath": "/root/child" },
        ]));
        assert_eq!(collect_child_thread_ids(&all), vec!["child-1".to_string()]);
    }

    #[test]
    fn collects_the_child_thread_id_from_a_waits_receiver_list() {
        let all = items(json!([
            { "id": "w1", "type": "collabAgentToolCall", "tool": "wait", "status": "completed", "receiverThreadIds": ["child-2"] },
        ]));
        assert_eq!(collect_child_thread_ids(&all), vec!["child-2".to_string()]);
    }

    #[test]
    fn dedupes_a_child_named_by_both_routes() {
        let all = items(json!([
            { "id": "s1", "type": "subAgentActivity", "kind": "started", "agentThreadId": "child-3", "agentPath": "/root/child" },
            { "id": "w1", "type": "collabAgentToolCall", "tool": "wait", "status": "completed", "receiverThreadIds": ["child-3"] },
        ]));
        assert_eq!(collect_child_thread_ids(&all), vec!["child-3".to_string()]);
    }

    #[test]
    fn ignores_a_non_wait_collab_tool_call_and_a_started_ping_with_no_activity() {
        let all = items(json!([
            { "id": "sp1", "type": "collabAgentToolCall", "tool": "spawnAgent", "status": "completed", "receiverThreadIds": ["child-4"] },
        ]));
        assert_eq!(collect_child_thread_ids(&all), Vec::<String>::new());
    }
}
