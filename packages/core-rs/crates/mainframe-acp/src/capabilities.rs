//! Mainframe's `_mainframe.dev` capability advertisement, riding
//! `initialize`'s response `_meta` (todo #350, plan task 8), plus the
//! `_mainframe.dev/heartbeat` notification builder (task 9). Every value is
//! fixture-pinned in `mainframe-types`' `extensions.capabilities.json` /
//! `initialize.response.json` / `heartbeat.notification.json` — this module
//! only assembles them.

use mainframe_types::acp::extensions::{
    GateResolvedParams, HeartbeatParams, MainframeCapabilities,
};
use mainframe_types::acp::jsonrpc::JsonRpcNotification;

/// Production default heartbeat cadence, matching the vendored fixtures
/// (`heartbeat.notification.json`'s sibling `initialize.response.json`
/// advertises `heartbeatIntervalMs: 15000`). Callers that need a tighter
/// cadence (integration tests) configure it explicitly rather than relying
/// on this constant.
pub const DEFAULT_HEARTBEAT_INTERVAL_MS: u64 = 15_000;

/// The daemon's `_mainframe.dev` capability set, parameterized on the
/// heartbeat cadence actually in force so a shortened test cadence is
/// truthfully advertised rather than echoing the production constant.
pub fn mainframe_capabilities(heartbeat_interval_ms: u64) -> MainframeCapabilities {
    MainframeCapabilities {
        rich_permission_answers: Some(true),
        queued_prompts: Some(true),
        retry_markers: Some(true),
        heartbeat_interval_ms: Some(heartbeat_interval_ms as i64),
    }
}

/// The `_mainframe.dev/heartbeat` notification (plan task 9): `sequence` lets
/// a client detect a gap (a jump larger than one) and resume instead of
/// heuristically refetching (spec decision 13).
pub fn heartbeat_notification(sequence: u64) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".into(),
        method: "_mainframe.dev/heartbeat".into(),
        params: Some(serde_json::json!(HeartbeatParams { sequence })),
    }
}

/// The `_mainframe.dev/gate_resolved` notification (spec decision 19): sent
/// to every attached connection still holding a pending gate when it resolves
/// elsewhere, so the client clears it immediately instead of on its next
/// resume. `rpc_id` is the string form of the gate's `session/request_permission`
/// JSON-RPC id (`gate-{requestId}`) — exactly what the client keyed the
/// pending gate under.
pub fn gate_resolved_notification(session_id: &str, rpc_id: &str) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".into(),
        method: "_mainframe.dev/gate_resolved".into(),
        params: Some(serde_json::json!(GateResolvedParams {
            session_id: session_id.to_string(),
            request_id: rpc_id.to_string(),
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_pinned_fixture_shape() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../mainframe-types/tests/fixtures/acp/extensions.capabilities.json"
        ))
        .unwrap();
        let caps = mainframe_capabilities(DEFAULT_HEARTBEAT_INTERVAL_MS);
        let value = serde_json::to_value(caps).unwrap();

        assert_eq!(
            value["richPermissionAnswers"],
            fixture["richPermissionAnswers"]
        );
        assert_eq!(value["queuedPrompts"], fixture["queuedPrompts"]);
        assert_eq!(value["retryMarkers"], fixture["retryMarkers"]);
        assert_eq!(value["heartbeatIntervalMs"], fixture["heartbeatIntervalMs"]);
    }

    #[test]
    fn heartbeat_notification_matches_the_pinned_method_name() {
        let note = heartbeat_notification(42);
        let value = serde_json::to_value(&note).unwrap();
        assert_eq!(value["method"], "_mainframe.dev/heartbeat");
        assert_eq!(value["params"]["sequence"], serde_json::json!(42));
    }

    #[test]
    fn gate_resolved_notification_matches_the_pinned_fixture_shape() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../mainframe-types/tests/fixtures/acp/gate-resolved.notification.json"
        ))
        .unwrap();
        let note = gate_resolved_notification("chat_1", "gate-req_1");
        let mut value = serde_json::to_value(&note).unwrap();
        value["_provenance"] = fixture["_provenance"].clone();
        assert_eq!(value, fixture);
    }
}
