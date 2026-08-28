//! Mainframe's `_mainframe.dev` capability advertisement, riding
//! `initialize`'s response `_meta` (todo #350, plan task 8; extended by task
//! 9 for the heartbeat notification builder). Every value is fixture-pinned
//! in `mainframe-types`' `extensions.capabilities.json` /
//! `initialize.response.json` — this module only assembles them.

use mainframe_types::acp::extensions::MainframeCapabilities;

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
}
