use crate::jsonrpc::JsonRpcClient;
use crate::rollout_reader::read_rollout_items;
use crate::session::de;
use crate::thread_registry::AgentMetadata;
use crate::types::{ThreadItem, ThreadReadResult};
use mainframe_adapter_api::{AdapterError, HistoryDependency};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

type ChildItems = HashMap<String, Vec<ThreadItem>>;
struct ChildHistory {
    items: Vec<ThreadItem>,
    source: Option<HistoryDependency>,
}

pub(super) async fn load_children(
    temp: &Arc<JsonRpcClient>,
    ids: &[String],
    metadata: &HashMap<String, AgentMetadata>,
) -> Result<(ChildItems, Option<Vec<HistoryDependency>>), AdapterError> {
    let mut items = HashMap::new();
    let mut dependencies = Some(Vec::new());
    for id in ids {
        let Some(child) = read_child(temp, id, metadata.get(id)).await? else {
            dependencies = None;
            continue;
        };
        match child.source {
            Some(source) => {
                if let Some(sources) = dependencies.as_mut() {
                    sources.push(source);
                }
            }
            None => dependencies = None,
        }
        items.insert(id.clone(), child.items);
    }
    Ok((items, dependencies))
}

async fn read_child(
    temp: &Arc<JsonRpcClient>,
    id: &str,
    metadata: Option<&AgentMetadata>,
) -> Result<Option<ChildHistory>, AdapterError> {
    let rollout = metadata.and_then(|m| m.rollout_path.as_deref());
    if let Some(path) = rollout.filter(|path| !is_compressed(path)) {
        let before = HistoryDependency::capture(path.into()).await;
        let items = read_rollout_items(path, Some(id), None).await;
        if !items.is_empty() {
            return Ok(Some(ChildHistory {
                items,
                source: still_current(before).await,
            }));
        }
    }
    // The CLI reads the rollout for us here, including a zstd-compressed one
    // the text reader cannot. Stamping that file around the call keeps the
    // child cacheable: the parent's own history comes from `thread/read` and
    // is pinned to its rollout's stamp the same way.
    let before = match rollout {
        Some(path) if names_thread(path, id) => HistoryDependency::capture(path.into()).await,
        _ => None,
    };
    let value = match temp
        .request(
            "thread/read",
            Some(json!({ "threadId": id, "includeTurns": true })),
        )
        .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(error = %error.0, child_id = id, "failed to read child thread, nesting will be skipped");
            return Ok(None);
        }
    };
    let result: ThreadReadResult = de(value)?;
    let items = result
        .thread
        .turns
        .unwrap_or_default()
        .into_iter()
        .flat_map(|turn| turn.items)
        .collect();
    Ok(Some(ChildHistory {
        items,
        source: still_current(before).await,
    }))
}

async fn still_current(stamp: Option<HistoryDependency>) -> Option<HistoryDependency> {
    match stamp {
        Some(stamp) if stamp.is_current().await => Some(stamp),
        _ => None,
    }
}

/// Codex compresses a finished thread's rollout to `*.jsonl.zst`.
fn is_compressed(path: &str) -> bool {
    path.ends_with(".zst")
}

/// The rollout path comes from the CLI's database; like the text reader, only
/// trust one whose file name carries the thread's id.
fn names_thread(path: &str, id: &str) -> bool {
    std::path::Path::new(path)
        .file_name()
        .is_some_and(|name| name.to_string_lossy().contains(id))
}

#[cfg(test)]
#[path = "history_children_tests.rs"]
mod tests;
