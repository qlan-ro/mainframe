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

    // Collect spawned sub-agent thread ids referenced by `wait` collabAgentToolCall items.
    let mut child_thread_ids: Vec<String> = Vec::new();
    for item in &all_items {
        if let ThreadItem::CollabAgentToolCall(c) = item
            && c.tool == "wait"
            && let Some(ids) = &c.receiver_thread_ids
        {
            for id in ids {
                if !child_thread_ids.contains(id) {
                    child_thread_ids.push(id.clone());
                }
            }
        }
    }

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
