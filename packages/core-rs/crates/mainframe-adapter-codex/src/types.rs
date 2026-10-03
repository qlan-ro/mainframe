//! Ported from `packages/core/src/plugins/builtin/codex/types.ts`.
//!
//! JSON-RPC 2.0 framing + Codex app-server protocol serde types. INTERNAL to this
//! crate (crate-map §2.8): they deserialize from / serialize to the Codex
//! app-server, NOT the daemon wire, so field casing tracks Codex exactly (mostly
//! camelCase; `CollaborationModeSettings` fields are snake_case as Codex emits
//! them). Unknown inbound fields are tolerated (serde ignores them).

use mainframe_types::adapter::EffortLevel;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub use crate::item_types::ThreadItem;

// --- JSON-RPC 2.0 framing ---

/// `RequestId = string | number`. Hash/Eq so it keys the pending-request map.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RequestId {
    Number(i64),
    String(String),
}

/// `'id' in msg && 'result' in msg`.
pub fn is_json_rpc_response(msg: &Map<String, Value>) -> bool {
    msg.contains_key("id") && msg.contains_key("result")
}

/// `'id' in msg && 'error' in msg`.
pub fn is_json_rpc_error(msg: &Map<String, Value>) -> bool {
    msg.contains_key("id") && msg.contains_key("error")
}

/// `'method' in msg && !('id' in msg)`.
pub fn is_json_rpc_notification(msg: &Map<String, Value>) -> bool {
    msg.contains_key("method") && !msg.contains_key("id")
}

/// `'method' in msg && 'id' in msg`.
pub fn is_json_rpc_server_request(msg: &Map<String, Value>) -> bool {
    msg.contains_key("method") && msg.contains_key("id")
}

// --- Initialize ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub user_agent: String,
    pub codex_home: String,
}

// --- Thread ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThreadRef {
    pub id: String,
    /// Present only on a `thread/fork` response — "Source thread id when this
    /// thread was created by forking another thread" (todo #368, established
    /// fact: `ThreadForkResponse.json`, `definitions.Thread.forkedFromId`).
    /// `#[serde(default)]` so `thread/start`/`thread/resume` (which never send
    /// this key) still deserialize.
    #[serde(default, rename = "forkedFromId")]
    pub forked_from_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThreadStartResult {
    pub thread: ThreadRef,
    /// Required in the app-server schema, but read leniently: an older build that
    /// omits it must not fail the whole `thread/start` deserialization — the
    /// turn-start model resolver (`turn_model.rs`) has a further fallback tier.
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThreadResumeResult {
    pub thread: ThreadRef,
    #[serde(default)]
    pub model: Option<String>,
}

pub use crate::thread_read_types::*;

// --- Turn ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TurnRef {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TurnStartResult {
    pub turn: TurnRef,
}

// --- Approvals ---

pub type ApprovalDecision = String;

pub use crate::notification_types::*;

// --- Config ---

pub type ApprovalPolicy = String;
pub type SandboxMode = String;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SandboxPolicy {
    #[serde(rename = "type")]
    pub kind: String,
}

/// Codex `collaborationMode.settings` — fields are snake_case as Codex emits them
/// (`reasoning_effort`, `developer_instructions`), so NO camelCase rename here.
/// `model` is required and non-nullable in the app-server's `Settings.ts` (codex-cli
/// 0.144.3) — omitting or nulling it fails the request with `-32600`, so callers must
/// resolve a concrete id before building this struct. `reasoning_effort` and
/// `developer_instructions` are required-but-nullable and serialize as explicit
/// `null` when absent (the TS shape is `string | null`, always present).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollaborationModeSettings {
    pub model: String,
    pub reasoning_effort: Option<EffortLevel>,
    pub developer_instructions: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollaborationMode {
    pub mode: String,
    pub settings: CollaborationModeSettings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningEffortOption {
    pub reasoning_effort: EffortLevel,
    pub description: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub hidden: Option<bool>,
    #[serde(default)]
    pub is_default: Option<bool>,
    #[serde(default)]
    pub supported_reasoning_efforts: Option<Vec<ReasoningEffortOption>>,
    #[serde(default)]
    pub default_reasoning_effort: Option<EffortLevel>,
    #[serde(default)]
    pub additional_speed_tiers: Option<Vec<String>>,
    #[serde(default)]
    pub supports_personality: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelListResult {
    pub data: Vec<ModelInfo>,
}

// --- User input ---

/// `UserInput = TextInput | LocalImageInput`, tagged on `type`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UserInput {
    Text {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        text_elements: Option<Vec<Value>>,
    },
    LocalImage {
        path: String,
    },
}

// --- Usage ---

/// Codex `usage` fields are snake_case as Codex emits them (`input_tokens`,
/// `cached_input_tokens`, `output_tokens`), so NO camelCase rename here — the TS
/// `Usage` interface and `handleTokenUsage` read `params.usage.input_tokens`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<i64>,
    pub output_tokens: i64,
}

// --- Rate limits (plan quota; not context-window usage) ---

/// `usedPercent` is 0-100; `resetsAt` is unix seconds (not ms).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitWindow {
    pub used_percent: f64,
    pub window_duration_mins: Option<i64>,
    pub resets_at: Option<i64>,
}

/// At most two windows per snapshot; identify by `windowDurationMins`, never by slot name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitSnapshot {
    pub limit_id: Option<String>,
    pub limit_name: Option<String>,
    pub primary: Option<RateLimitWindow>,
    pub secondary: Option<RateLimitWindow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRateLimitsUpdatedParams {
    pub rate_limits: RateLimitSnapshot,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAccountRateLimitsResult {
    pub rate_limits: RateLimitSnapshot,
}

// --- Account identity ---

/// Tagged on `type`; `Chatgpt`/`AmazonBedrock` camelCase to `chatgpt`/`amazonBedrock`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Account {
    ApiKey,
    Chatgpt {
        email: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        plan_type: Option<String>,
    },
    AmazonBedrock {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        credential_source: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAccountResult {
    pub account: Option<Account>,
    pub requires_openai_auth: bool,
}

#[cfg(test)]
#[path = "types_tests.rs"]
mod tests;
