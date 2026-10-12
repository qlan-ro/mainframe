use mainframe_types::sync::LockExt as _;
use std::sync::Mutex;

use serde_json::json;

use mainframe_types::content::LeafContent;

use crate::fixture::EventDirection;

use super::*;

#[derive(Default)]
struct RecordingSink {
    cancelled: Mutex<Vec<String>>,
    api_retries: Mutex<Vec<(i64, Option<String>)>>,
    partials: Mutex<Vec<(String, Vec<MessageContent>)>>,
}
impl SessionSink for RecordingSink {
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

    fn on_permission_cancelled(&self, request_id: &str) {
        self.cancelled.lock_recover().push(request_id.to_string());
    }
    fn on_api_retry(&self, attempt: i64, reason: Option<String>) {
        self.api_retries.lock_recover().push((attempt, reason));
    }
    fn on_message_partial(&self, api_message_id: &str, content: Vec<MessageContent>) {
        self.partials
            .lock_recover()
            .push((api_message_id.to_string(), content));
    }
}

fn recorded(method: &str, args: Vec<Value>) -> RecordedEvent {
    RecordedEvent {
        dir: EventDirection::Out,
        method: method.into(),
        args,
        delay_ms: 0,
        files: Vec::new(),
        deleted: Vec::new(),
    }
}

#[test]
fn dispatches_a_recorded_on_permission_cancelled() {
    let sink = Arc::new(RecordingSink::default());
    let dyn_sink: Arc<dyn SessionSink> = sink.clone();
    let event = recorded("onPermissionCancelled", vec![json!("req_1")]);

    dispatch(&dyn_sink, &event).unwrap();

    assert_eq!(*sink.cancelled.lock_recover(), vec!["req_1".to_string()]);
}

#[test]
fn dispatches_a_recorded_on_api_retry() {
    let sink = Arc::new(RecordingSink::default());
    let dyn_sink: Arc<dyn SessionSink> = sink.clone();
    let event = recorded("onApiRetry", vec![json!(2), json!("overloaded_error")]);

    dispatch(&dyn_sink, &event).unwrap();

    assert_eq!(
        *sink.api_retries.lock_recover(),
        vec![(2, Some("overloaded_error".to_string()))]
    );
}

#[test]
fn dispatches_a_recorded_on_message_partial() {
    let sink = Arc::new(RecordingSink::default());
    let dyn_sink: Arc<dyn SessionSink> = sink.clone();
    let event = recorded(
        "onMessagePartial",
        vec![json!("msg_a"), json!([{ "type": "text", "text": "Hel" }])],
    );

    dispatch(&dyn_sink, &event).unwrap();

    let partials = sink.partials.lock_recover();
    assert_eq!(partials.len(), 1);
    assert_eq!(partials[0].0, "msg_a");
    assert_eq!(
        partials[0].1,
        vec![MessageContent::Leaf(LeafContent::Text {
            text: "Hel".to_string(),
            parent_tool_use_id: None,
        })]
    );
}

#[test]
fn an_unknown_method_returns_ok_without_touching_the_sink() {
    let sink = Arc::new(RecordingSink::default());
    let dyn_sink: Arc<dyn SessionSink> = sink.clone();
    let event = recorded("onSomethingNobodyHeardOf", vec![json!("x")]);

    dispatch(&dyn_sink, &event).unwrap();

    assert!(sink.cancelled.lock_recover().is_empty());
}
