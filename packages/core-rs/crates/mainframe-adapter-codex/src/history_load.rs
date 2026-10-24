//! `load_history_inner` — the loadHistory temp-app-server + thread/read
//! recursion, kept apart from `session.rs` to keep that file smaller.

use std::collections::HashMap;
use std::sync::Arc;

use mainframe_adapter_api::AdapterError;
use mainframe_types::chat::ChatMessage;
use serde_json::json;

use crate::jsonrpc::JsonRpcClient;
use crate::presentation_history::convert_turns;
#[path = "history_children.rs"]
mod children;
use crate::session::de;
use crate::thread_registry::{AgentMetadata, lookup_agent_metadata};
use crate::types::{ThreadItem, ThreadReadResult, ThreadReadTurn};
use children::load_children;
use mainframe_adapter_api::HistoryDependency;

/// An unsent fork's `load_history` reads the *source* thread through its pinned
/// `last_turn_id`, inclusive — everything after stays invisible until the
/// fork's own first turn actually inherits it via `thread/fork`. A cap id
/// absent from the source (fork point retired, or a stale pin) keeps every turn
/// rather than silently emptying the transcript. Pure and unit-testable, split
/// out of `load_history_inner`'s live-client call.
pub(crate) fn truncate_at_turn_cap(
    mut turns: Vec<ThreadReadTurn>,
    turn_cap: Option<&str>,
    thread_id: &str,
) -> Vec<ThreadReadTurn> {
    let Some(cap_id) = turn_cap else {
        return turns;
    };
    match turns.iter().position(|t| t.id == cap_id) {
        Some(idx) => turns.truncate(idx + 1),
        None => {
            tracing::warn!(
                cap_id,
                thread_id,
                "fork turn cap id not found in the source thread; keeping all turns"
            );
        }
    }
    turns
}

pub(crate) struct LoadedHistory {
    pub messages: Vec<ChatMessage>,
    pub dependencies: Option<Vec<HistoryDependency>>,
    pub state: serde_json::Value,
}

pub(crate) async fn load_history_inner(
    temp: &Arc<JsonRpcClient>,
    resume_thread_id: &str,
    project_path: &str,
    turn_cap: Option<&str>,
) -> Result<LoadedHistory, AdapterError> {
    let _ = project_path;
    let read: ThreadReadResult = de(temp
        .request(
            "thread/read",
            Some(json!({ "threadId": resume_thread_id, "includeTurns": true })),
        )
        .await
        .map_err(AdapterError::from)?)?;

    let turns = truncate_at_turn_cap(
        read.thread.turns.unwrap_or_default(),
        turn_cap,
        resume_thread_id,
    );

    let all_items: Vec<ThreadItem> = turns.iter().flat_map(|t| t.items.iter().cloned()).collect();

    let child_thread_ids = collect_child_thread_ids(&all_items);

    let agent_meta_by_thread: HashMap<String, AgentMetadata> = if child_thread_ids.is_empty() {
        HashMap::new()
    } else {
        lookup_agent_metadata(&child_thread_ids)
    };

    let (child_items_by_thread, dependencies) =
        load_children(temp, &child_thread_ids, &agent_meta_by_thread).await?;
    Ok(LoadedHistory {
        dependencies,
        state: json!(agent_meta_by_thread),
        messages: convert_turns(
            &turns,
            resume_thread_id,
            &child_items_by_thread,
            &agent_meta_by_thread,
        ),
    })
}

/// Child thread ids to fetch and nest, from both naming routes: a
/// `subAgentActivity` ping of any kind, and a `wait`'s `receiverThreadIds` (the
/// legacy route). Deduped and order-preserving.
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
#[path = "history_load_tests.rs"]
mod tests;
