use crate::item_types::ThreadItem;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadReadTurn {
    pub id: String,
    pub status: String,
    #[serde(deserialize_with = "deserialize_lenient_items")]
    pub items: Vec<ThreadItem>,
    #[serde(flatten)]
    pub timing: crate::presentation_fields::ProviderTiming,
}

/// Deserialize a turn's `items`, dropping any item whose `type` Codex added after
/// this port (or whose shape changed) instead of failing the whole `thread/read`.
///
/// `ThreadItem` is an internally-tagged enum with no unknown-variant fallback, so a
/// single unrecognized item (e.g. `contextCompaction` after a compaction, or
/// `subAgentActivity` from multi-agent) would otherwise abort deserialization of the
/// entire transcript and render it empty. This mirrors the TS reload path, where
/// `convertThreadItems`'s `switch` silently skips items it doesn't handle.
fn deserialize_lenient_items<'de, D>(deserializer: D) -> Result<Vec<ThreadItem>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw: Vec<Value> = Vec::deserialize(deserializer)?;
    Ok(raw
        .into_iter()
        .filter_map(|v| {
            let kind = v
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            match serde_json::from_value::<ThreadItem>(v) {
                Ok(item) => Some(item),
                Err(err) => {
                    tracing::debug!(
                        module = "codex:history",
                        r#type = kind,
                        err = %err,
                        "codex: skipping unrecognized thread item on history reload"
                    );
                    None
                }
            }
        })
        .collect())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadReadThread {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turns: Option<Vec<ThreadReadTurn>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThreadReadResult {
    pub thread: ThreadReadThread,
}
