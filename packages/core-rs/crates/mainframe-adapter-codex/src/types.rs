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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThreadStartResult {
    pub thread: ThreadRef,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThreadResumeResult {
    pub thread: ThreadRef,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadReadTurn {
    pub id: String,
    pub status: String,
    pub items: Vec<ThreadItem>,
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

// --- Event notification params ---

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ThreadStartedParams {
    pub thread: ThreadRef,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TurnIdRef {
    pub id: String,
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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCompletedParams {
    #[serde(default)]
    pub thread_id: Option<String>,
    pub turn: TurnCompleted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageUpdatedParams {
    #[serde(default)]
    pub thread_id: Option<String>,
    pub usage: Usage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDeltaParams {
    pub item_id: String,
    pub delta: String,
}

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
/// `model` is optional (omitted when no model is selected, so Codex uses the
/// account default); `reasoning_effort`/`developer_instructions` serialize as
/// explicit `null` when absent (the TS shape is `string | null`, always present).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollaborationModeSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Build the `serde_json::Map` the predicates operate on from a JSON object.
    fn obj(v: Value) -> Map<String, Value> {
        match v {
            Value::Object(m) => m,
            _ => panic!("expected object"),
        }
    }

    // --- JSON-RPC message type guards (codex-types.test.ts) ---

    #[test]
    fn identifies_a_response_has_id_and_result() {
        assert!(is_json_rpc_response(&obj(
            json!({ "id": 1, "result": { "thread": { "id": "thr_1" } } })
        )));
    }

    #[test]
    fn identifies_an_error_has_id_and_error() {
        assert!(is_json_rpc_error(&obj(
            json!({ "id": 1, "error": { "code": -32600, "message": "Invalid" } })
        )));
    }

    #[test]
    fn identifies_a_notification_has_method_no_id() {
        assert!(is_json_rpc_notification(&obj(
            json!({ "method": "thread/started", "params": {} })
        )));
    }

    #[test]
    fn identifies_a_server_request_has_method_and_id() {
        assert!(is_json_rpc_server_request(&obj(json!({
            "id": 5,
            "method": "item/commandExecution/requestApproval",
            "params": {}
        }))));
    }

    #[test]
    fn does_not_confuse_response_with_server_request() {
        assert!(!is_json_rpc_server_request(&obj(
            json!({ "id": 1, "result": {} })
        )));
    }

    #[test]
    fn does_not_confuse_notification_with_response() {
        assert!(!is_json_rpc_response(&obj(
            json!({ "method": "turn/started", "params": {} })
        )));
    }
}

// PORT STATUS: src/plugins/builtin/codex/types.ts (261 lines)
// confidence: high
// todos: 0
// notes: #430 — dropped ThreadSummary/ThreadListResult (the thread/list RPC path is
// notes: gone; external sessions now scan rollout JSONL on disk). CollaborationModeSettings.
// notes: model is now Option<String> (skip_serializing_if) so turn/start omits `model`
// notes: when none is selected and Codex uses the account default.
// notes: JSON-RPC framing modelled with a RequestId enum (Number|String, untagged)
// notes: + the four is_json_rpc_* predicates over a serde_json::Map. Event params
// notes: whose `item` may be the non-union `type: 'plan'` shape keep `item: Value`
// notes: so the event-mapper can branch defensively before typed dispatch.
// notes: CollaborationModeSettings AND Usage fields stay snake_case (Codex protocol) —
// notes: the TS `Usage` interface + `handleTokenUsage` read `usage.input_tokens`, so a
// notes: camelCase rename here silently broke `TokenUsageUpdatedParams` deserialize
// notes: (last_usage never set); dropped it in the audit. Request param structs are
// notes: constructed ad-hoc (serde_json) by session/adapter so only the *result*/*param*
// notes: shapes we deserialize are declared here. Types are internal to the crate, not
// notes: daemon wire types. Type-guard tests (codex-types.test.ts) ported inline.
