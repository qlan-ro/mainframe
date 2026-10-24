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
    if let Some(path) = metadata.and_then(|m| m.rollout_path.as_ref()) {
        let before = HistoryDependency::capture(path.into()).await;
        let items = read_rollout_items(path, Some(id), None).await;
        if !items.is_empty() {
            let source = match before {
                Some(source) if source.is_current().await => Some(source),
                _ => None,
            };
            return Ok(Some(ChildHistory { items, source }));
        }
    }
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
        source: None,
    }))
}
