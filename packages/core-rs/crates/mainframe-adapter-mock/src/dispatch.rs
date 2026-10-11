use crate::recorded_method::RecordedMethod;
use std::sync::Arc;

use mainframe_adapter_api::{AdapterError, LoadedSkill, SessionSink};
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, MessageMetadata, ProviderQuota, SessionResult,
};
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::fixture::{RecordedEvent, RecordedEventError};

fn arg<T: DeserializeOwned>(event: &RecordedEvent, index: usize) -> Result<T, RecordedEventError> {
    let value = event
        .args
        .get(index)
        .cloned()
        .ok_or(RecordedEventError::MissingArgument(index))?;
    Ok(serde_json::from_value(value)?)
}

pub(crate) fn emit_event(sink: Arc<dyn SessionSink>, event: RecordedEvent) {
    if let Err(error) = dispatch(&sink, &event) {
        tracing::warn!(method = %event.method, %error, "mock-cli dropped invalid recorded event");
    }
}

fn dispatch(sink: &Arc<dyn SessionSink>, event: &RecordedEvent) -> Result<(), RecordedEventError> {
    match &event.method {
        RecordedMethod::OnInit => sink.on_init(&arg::<String>(event, 0)?),
        RecordedMethod::OnMessage => sink.on_message(
            arg::<Vec<MessageContent>>(event, 0)?,
            arg::<Option<MessageMetadata>>(event, 1)?,
        ),
        // `args[1]` (the vendor id) is optional so pre-existing recorded
        // fixtures that predate it keep replaying unchanged.
        RecordedMethod::OnToolResult => sink.on_tool_result(
            arg(event, 0)?,
            match event.args.get(1) {
                Some(_) => arg::<Option<String>>(event, 1)?,
                None => None,
            },
        ),
        RecordedMethod::OnPermission => sink.on_permission(arg::<ControlRequest>(event, 0)?),
        RecordedMethod::OnPermissionCancelled => {
            sink.on_permission_cancelled(&arg::<String>(event, 0)?)
        }
        RecordedMethod::OnResult => sink.on_result(arg::<SessionResult>(event, 0)?),
        RecordedMethod::OnExit => sink.on_exit(arg::<Option<i32>>(event, 0)?),
        RecordedMethod::OnError => sink.on_error(AdapterError::Message(recorded_error(event)?)),
        // `args[0]` (the vendor id) is optional so pre-existing recorded
        // fixtures that predate it keep replaying unchanged.
        RecordedMethod::OnCompact => {
            let vendor_id = match event.args.first() {
                Some(_) => arg::<Option<String>>(event, 0)?,
                None => None,
            };
            sink.on_compact(vendor_id.as_deref())
        }
        RecordedMethod::OnCompactStart => sink.on_compact_start(),
        RecordedMethod::OnContextUsage => sink.on_context_usage(arg::<ContextUsage>(event, 0)?),
        RecordedMethod::OnPlanFile => sink.on_plan_file(&arg::<String>(event, 0)?),
        RecordedMethod::OnSkillFile => sink.on_skill_file(arg::<SkillFileEntry>(event, 0)?),
        RecordedMethod::OnQueuedProcessed => sink.on_queued_processed(&arg::<String>(event, 0)?),
        RecordedMethod::OnTodoUpdate => sink.on_todo_update(arg::<Vec<TodoItem>>(event, 0)?),
        RecordedMethod::OnPrDetected => sink.on_pr_detected(arg::<DetectedPr>(event, 0)?),
        RecordedMethod::OnCliMessage => sink.on_cli_message(&arg::<String>(event, 0)?),
        RecordedMethod::OnSkillLoaded => sink.on_skill_loaded(arg::<LoadedSkill>(event, 0)?),
        RecordedMethod::OnSubagentChild => sink.on_subagent_child(
            &arg::<String>(event, 0)?,
            arg::<Vec<MessageContent>>(event, 1)?,
        ),
        RecordedMethod::OnTrustRequired => sink.on_trust_required(&arg::<String>(event, 0)?),
        RecordedMethod::OnProviderQuota => {
            sink.on_provider_quota(&arg::<String>(event, 0)?, arg::<ProviderQuota>(event, 1)?)
        }
        // Lets a captured `api_error` retry be replayed through the sink.
        RecordedMethod::OnApiRetry => {
            sink.on_api_retry(arg::<i64>(event, 0)?, arg::<Option<String>>(event, 1)?)
        }
        // A recording can emit a partial for message A, then
        // `onApiRetry`, then the completed message B — the sequence the
        // no-ghost-bubble e2e scenario asserts against.
        RecordedMethod::OnMessagePartial => sink.on_message_partial(
            arg::<String>(event, 0)?.as_str(),
            arg::<Vec<MessageContent>>(event, 1)?,
        ),
        method => tracing::warn!(%method, "mock-cli ignored unknown recorded sink method"),
    }
    Ok(())
}

/// The recorded CLI error text, which replays verbatim as `AdapterError::Message`.
fn recorded_error(event: &RecordedEvent) -> Result<String, RecordedEventError> {
    let value = event
        .args
        .first()
        .ok_or(RecordedEventError::MissingArgument(0))?;
    if let Some(message) = value.as_str() {
        return Ok(message.to_string());
    }
    value
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or(RecordedEventError::InvalidError)
}

#[cfg(test)]
#[path = "dispatch_tests.rs"]
mod tests;
