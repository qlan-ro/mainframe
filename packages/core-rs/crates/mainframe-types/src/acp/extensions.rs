//! Mainframe's `_mainframe.dev` extension namespace — everything ACP has no
//! construct for, riding `_meta` and `_`-prefixed custom methods per the
//! schema's extensibility discipline (ACP-EVALUATION.md "What to borrow" #6:
//! "a reserved `_meta` on every frame, `_`-prefixed enum values reserved for
//! implementations, and the rule that unknown values must not be treated as
//! approval"). Every type here is opaque to core ACP — a client that doesn't
//! recognize the namespace ignores it and gets a degraded but coherent
//! experience (spec: "Generic ACP clients that advertise no Mainframe
//! capabilities get a degraded but coherent chat experience").

use serde::{Deserialize, Serialize};

use crate::adapter::ControlResponse;
use crate::chat::DiffHunk;

/// The `_meta` key every extension value below is namespaced under.
pub const MAINFRAME_META_NAMESPACE: &str = "_mainframe.dev";

/// Mainframe's agent-capabilities extension, advertised in `initialize`'s
/// response under `_meta["_mainframe.dev"]`. Generic ACP clients see none of
/// these keys and degrade gracefully (spec: "option-only gates, no
/// queued-turn metadata").
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainframeCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_permission_answers: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queued_prompts: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_markers: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heartbeat_interval_ms: Option<i64>,
}

/// `api_retry` modeled as a content-replacing patch plus this marker (spec
/// decision 10), riding a message/tool-call upsert's `_meta["_mainframe.dev"]`
/// alongside the replaced `content` — never a distinct lifecycle frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryMarker {
    pub attempt: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Queued-prompt state (spec decision 11): an ordinary accepted prompt's
/// `PromptResponse._meta["_mainframe.dev"]` carries this while the prompt
/// waits for its turn. No `queue.*` frame family exists on the facade.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedPromptState {
    pub position: i64,
}

/// The rich permission answer (spec decision 12): today's `ControlResponse`
/// semantics (input mutation, suggestion rules, execution mode, clear
/// context), reused verbatim per the single-canonical-type rule rather than
/// redefined for the facade. Rides `RequestPermissionResponse._meta
/// ["_mainframe.dev"]` alongside the plain `{outcome, optionId}` answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichPermissionAnswer {
    pub control_response: ControlResponse,
}

/// The fidelity payload a `diff` tool-call content entry carries in its own
/// `_meta["_mainframe.dev"]` (spec Decision 15): the legacy display
/// pipeline's structured hunks plus the full before/after file text —
/// neither survives a round trip through git-patch text (the full files
/// aren't in it at all), and the desktop Edit/Write cards consume exactly
/// this shape (`mapToolResult`). Generic ACP clients ignore it and render
/// the sibling `patch` text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredDiff {
    pub structured_patch: Vec<DiffHunk>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_file: Option<String>,
}

/// Params for the daemon's custom `_mainframe.dev/heartbeat` notification
/// (spec decision 13: "heartbeat plus resume-replay is the documented rule").
/// `sequence` lets a client detect a gap (a jump larger than one) and resume
/// instead of heuristically refetching.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatParams {
    pub sequence: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn capabilities_omit_all_absent_fields() {
        let caps = MainframeCapabilities {
            rich_permission_answers: None,
            queued_prompts: None,
            retry_markers: None,
            heartbeat_interval_ms: None,
        };
        assert_eq!(serde_json::to_value(caps).unwrap(), json!({}));
    }
}
