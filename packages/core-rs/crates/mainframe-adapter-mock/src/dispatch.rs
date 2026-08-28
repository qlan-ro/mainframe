use std::sync::Arc;

use mainframe_adapter_api::{AdapterError, LoadedSkill, SessionSink};
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, MessageMetadata, ProviderQuota, SessionResult,
};
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::fixture::RecordedEvent;

fn arg<T: DeserializeOwned>(event: &RecordedEvent, index: usize) -> Result<T, String> {
    let value = event
        .args
        .get(index)
        .cloned()
        .ok_or_else(|| format!("missing argument {index}"))?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

pub(crate) fn emit_event(sink: Arc<dyn SessionSink>, event: RecordedEvent) {
    if let Err(error) = dispatch(&sink, &event) {
        tracing::warn!(method = %event.method, %error, "mock-cli dropped invalid recorded event");
    }
}

fn dispatch(sink: &Arc<dyn SessionSink>, event: &RecordedEvent) -> Result<(), String> {
    match event.method.as_str() {
        "onInit" => sink.on_init(&arg::<String>(event, 0)?),
        "onMessage" => sink.on_message(
            arg::<Vec<MessageContent>>(event, 0)?,
            arg::<Option<MessageMetadata>>(event, 1)?,
        ),
        // `args[1]` (the vendor id) is optional so pre-existing recorded
        // fixtures that predate it keep replaying unchanged.
        "onToolResult" => sink.on_tool_result(
            arg(event, 0)?,
            match event.args.get(1) {
                Some(_) => arg::<Option<String>>(event, 1)?,
                None => None,
            },
        ),
        "onPermission" => sink.on_permission(arg::<ControlRequest>(event, 0)?),
        "onPermissionCancelled" => sink.on_permission_cancelled(&arg::<String>(event, 0)?),
        "onResult" => sink.on_result(arg::<SessionResult>(event, 0)?),
        "onExit" => sink.on_exit(arg::<Option<i32>>(event, 0)?),
        "onError" => sink.on_error(AdapterError::Message(recorded_error(event)?)),
        "onCompact" => sink.on_compact(),
        "onCompactStart" => sink.on_compact_start(),
        "onContextUsage" => sink.on_context_usage(arg::<ContextUsage>(event, 0)?),
        "onPlanFile" => sink.on_plan_file(&arg::<String>(event, 0)?),
        "onSkillFile" => sink.on_skill_file(arg::<SkillFileEntry>(event, 0)?),
        "onQueuedProcessed" => sink.on_queued_processed(&arg::<String>(event, 0)?),
        "onTodoUpdate" => sink.on_todo_update(arg::<Vec<TodoItem>>(event, 0)?),
        "onPrDetected" => sink.on_pr_detected(arg::<DetectedPr>(event, 0)?),
        "onCliMessage" => sink.on_cli_message(&arg::<String>(event, 0)?),
        "onSkillLoaded" => sink.on_skill_loaded(arg::<LoadedSkill>(event, 0)?),
        "onSubagentChild" => sink.on_subagent_child(
            &arg::<String>(event, 0)?,
            arg::<Vec<MessageContent>>(event, 1)?,
        ),
        "onTrustRequired" => sink.on_trust_required(&arg::<String>(event, 0)?),
        "onProviderQuota" => {
            sink.on_provider_quota(&arg::<String>(event, 0)?, arg::<ProviderQuota>(event, 1)?)
        }
        method => tracing::warn!(%method, "mock-cli ignored unknown recorded sink method"),
    }
    Ok(())
}

fn recorded_error(event: &RecordedEvent) -> Result<String, String> {
    let value = event
        .args
        .first()
        .ok_or_else(|| "missing argument 0".to_string())?;
    if let Some(message) = value.as_str() {
        return Ok(message.to_string());
    }
    value
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "invalid recorded error".to_string())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use serde_json::json;

    use crate::fixture::EventDirection;

    use super::*;

    #[derive(Default)]
    struct RecordingSink {
        cancelled: Mutex<Vec<String>>,
    }
    impl SessionSink for RecordingSink {
        fn on_init(&self, _session_id: &str) {}
        fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {}
        fn on_tool_result(&self, _content: Vec<MessageContent>, _vendor_id: Option<String>) {}
        fn on_permission(&self, _request: ControlRequest) {}
        fn on_permission_cancelled(&self, request_id: &str) {
            self.cancelled
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(request_id.to_string());
        }
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

    fn recorded(method: &str, args: Vec<Value>) -> RecordedEvent {
        RecordedEvent {
            dir: EventDirection::Out,
            method: method.to_string(),
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

        assert_eq!(
            *sink.cancelled.lock().unwrap_or_else(|e| e.into_inner()),
            vec!["req_1".to_string()]
        );
    }

    #[test]
    fn an_unknown_method_returns_ok_without_touching_the_sink() {
        let sink = Arc::new(RecordingSink::default());
        let dyn_sink: Arc<dyn SessionSink> = sink.clone();
        let event = recorded("onSomethingNobodyHeardOf", vec![json!("x")]);

        dispatch(&dyn_sink, &event).unwrap();

        assert!(
            sink.cancelled
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_empty()
        );
    }
}
