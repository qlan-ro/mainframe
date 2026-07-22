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
        "onToolResult" => sink.on_tool_result(arg(event, 0)?),
        "onPermission" => sink.on_permission(arg::<ControlRequest>(event, 0)?),
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
