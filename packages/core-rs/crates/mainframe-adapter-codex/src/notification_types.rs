use crate::types::{ThreadRef, Usage};
use serde::{Deserialize, Serialize};
use serde_json::Value;

// --- Event notification params ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThreadStartedParams {
    pub thread: ThreadRef,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TurnIdRef {
    pub id: String,
    #[serde(flatten)]
    pub timing: crate::presentation_fields::ProviderTiming,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartedParams {
    #[serde(default)]
    pub thread_id: Option<String>,
    pub turn: TurnIdRef,
}

/// `item` stays a raw `Value` — the `item/completed` handler branches on a
/// non-union `type: 'plan'` shape before typed dispatch (see event-mapper).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCompletedParams {
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
    pub item: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStartedParams {
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
    pub item: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TurnError {
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCompleted {
    pub id: String,
    pub status: String,
    #[serde(default)]
    pub items: Vec<Value>,
    pub error: Option<TurnError>,
    #[serde(flatten)]
    pub timing: crate::presentation_fields::ProviderTiming,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCompletedParams {
    #[serde(default)]
    pub thread_id: Option<String>,
    pub turn: TurnCompleted,
}

/// Codex 0.144.3 wraps usage in `tokenUsage: { last, total }` (camelCase);
/// older builds still send a top-level `usage` (snake_case, see `Usage` below).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CamelUsage {
    pub input_tokens: i64,
    #[serde(default)]
    pub cached_input_tokens: Option<i64>,
    pub output_tokens: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageEnvelope {
    #[serde(default)]
    pub total: Option<CamelUsage>,
    #[serde(default)]
    pub last: Option<CamelUsage>,
    /// Absent on codex-cli 0.144.3 (see
    /// `tests/fixtures/collab-delegation-0.144.3.jsonl`), present from 0.153.4;
    /// `#[serde(default)]` keeps the older capture deserializing without it.
    #[serde(default)]
    pub model_context_window: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageUpdatedParams {
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub usage: Option<Usage>,
    #[serde(default)]
    pub token_usage: Option<TokenUsageEnvelope>,
}

impl TokenUsageUpdatedParams {
    /// Resolves the usage to report, preferring the legacy top-level `usage`,
    /// then the capture's `tokenUsage.last`, then `tokenUsage.total`.
    pub fn resolved_usage(&self) -> Option<Usage> {
        if let Some(usage) = &self.usage {
            return Some(usage.clone());
        }
        let envelope = self.token_usage.as_ref()?;
        let camel = envelope.last.as_ref().or(envelope.total.as_ref())?;
        Some(Usage {
            input_tokens: camel.input_tokens,
            cached_input_tokens: camel.cached_input_tokens,
            output_tokens: camel.output_tokens,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDeltaParams {
    pub item_id: String,
    pub delta: String,
}
