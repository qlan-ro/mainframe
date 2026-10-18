//! Quota notification mapping tests.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

mod common;

use std::sync::Arc;

use common::Recorder;
use mainframe_adapter_api::SessionSink;
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use serde_json::json;

fn state() -> CodexSessionState {
    CodexSessionState {
        thread_id: Some("t1".to_string()),
        ..Default::default()
    }
}

/// Doesn't override `on_provider_quota`, exercising the trait's default no-op body —
/// the Rust analogue of the TS `NULL_SINK` object literal that omits `onProviderQuota`.
struct NullSink;

impl SessionSink for NullSink {
    mainframe_adapter_api::forward_session_sink!(
        on_init,
        on_message,
        on_tool_result,
        on_permission,
        on_result,
        on_exit,
        on_error,
        on_compact,
        on_compact_start,
        on_context_usage,
        on_plan_file,
        on_skill_file,
        on_queued_processed,
        on_todo_update,
        on_pr_detected,
        on_cli_message,
        on_skill_loaded,
        on_subagent_child
    );
}

#[test]
fn emits_a_normalized_provider_quota_via_on_provider_quota() {
    let rec = Recorder::new();
    let sink = rec.sink();
    let mut state = state();

    handle_notification(
        "account/rateLimits/updated",
        &json!({
            "rateLimits": {
                "limitId": "codex",
                "limitName": null,
                "primary": { "usedPercent": 22, "windowDurationMins": 10080, "resetsAt": 1_784_845_911 },
                "secondary": null,
            }
        }),
        &sink,
        &mut state,
    );

    let quotas = rec.provider_quotas();
    assert_eq!(quotas.len(), 1);
    let (adapter_id, quota) = &quotas[0];
    assert_eq!(adapter_id, "codex");
    let weekly = quota.weekly.as_ref().unwrap();
    assert_eq!(weekly.used_percent, 22.0);
    assert_eq!(weekly.resets_at, Some(1_784_845_911_000));
}

#[test]
fn ignores_a_snapshot_from_a_bucket_other_than_the_plan() {
    let rec = Recorder::new();
    let sink = rec.sink();
    let mut state = state();

    handle_notification(
        "account/rateLimits/updated",
        &json!({
            "rateLimits": {
                "limitId": "premium",
                "limitName": null,
                "primary": { "usedPercent": 100, "windowDurationMins": 300, "resetsAt": 1_784_845_911 },
                "secondary": null,
            }
        }),
        &sink,
        &mut state,
    );

    assert!(rec.provider_quotas().is_empty());
}

#[test]
fn no_ops_when_the_sink_does_not_override_on_provider_quota() {
    let sink: Arc<dyn SessionSink> = Arc::new(NullSink);
    let mut state = state();

    handle_notification(
        "account/rateLimits/updated",
        &json!({
            "rateLimits": { "limitId": "codex", "limitName": null, "primary": null, "secondary": null }
        }),
        &sink,
        &mut state,
    );
}
