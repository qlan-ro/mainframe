//! Ports `__tests__/quota-notification.test.ts` assertion-for-assertion.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::sync::Arc;

use common::Recorder;
use mainframe_adapter_api::{AdapterError, ControlRequest, LoadedSkill, SessionSink};
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use mainframe_types::adapter::{ContextUsage, DetectedPr, MessageMetadata, SessionResult};
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;
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
    fn on_init(&self, _session_id: &str) {}
    fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {}
    fn on_tool_result(&self, _content: Vec<MessageContent>) {}
    fn on_permission(&self, _request: ControlRequest) {}
    fn on_result(&self, _data: SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<TodoItem>) {}
    fn on_pr_detected(&self, _pr: DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: LoadedSkill) {}
    fn on_subagent_child(&self, _parent_tool_use_id: &str, _blocks: Vec<MessageContent>) {}
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

// PORT STATUS: src/plugins/builtin/codex/__tests__/quota-notification.test.ts (63 lines)
// confidence: high
// todos: 0
// notes: `NullSink` implements every SessionSink method except on_provider_quota,
// notes: relying on the trait's default no-op body — Rust has no direct analogue of
// notes: the TS object-literal-missing-a-key trick, so this is the closest
// notes: equivalent (still proves the default path never panics).
