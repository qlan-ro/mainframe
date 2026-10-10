use serde_json::Value;

use mainframe_adapter_api::{AdapterError, SessionSink};
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, ControlUpdate, MessageUsage, SessionResult,
};

use crate::assistant_event::handle_assistant_event;
use crate::quota_rate_limit::normalize_rate_limit_event;
use crate::session::ClaudeSession;
use crate::task_events::{
    TaskNotificationPayload, TaskNotificationUsage, TaskStartedCtx, TaskStartedPayload,
};
use crate::user_event::handle_user_event;

pub fn handle_stdout(session: &ClaudeSession, chunk: &[u8], sink: &dyn SessionSink) {
    let lines: Vec<String> = {
        let mut st = session.state.lock().unwrap_or_else(|e| e.into_inner());
        st.buffer.push_str(&String::from_utf8_lossy(chunk));
        let mut parts: Vec<String> = st.buffer.split('\n').map(str::to_string).collect();
        st.buffer = parts.pop().unwrap_or_default();
        parts
    };

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        session.bump_last_activity();
        tracing::trace!(session_id = %session.id, line = %line, "[stream-json]");
        if let Ok(event) = serde_json::from_str::<Value>(line.trim()) {
            handle_event(session, &event, sink);
        }
    }
}
fn is_informational(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.starts_with("debugger")
        || lower.starts_with("warning:")
        || lower.starts_with("deprecationwarning")
        || lower.starts_with("experimentalwarning")
        || is_node_prefix(message)
        || message.starts_with("Cloning into")
}
fn is_node_prefix(message: &str) -> bool {
    let Some(rest) = message.strip_prefix("(node:") else {
        return false;
    };
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    !digits.is_empty() && rest[digits.len()..].starts_with(')')
}

fn is_trust_not_trusted(lower: &str) -> bool {
    lower.contains("has not been trusted")
}
fn is_trust_permissions(lower: &str) -> bool {
    lower.contains("permissions.allow") || lower.contains("hastrustdialogaccepted")
}

pub(crate) fn handle_stderr(session: &ClaudeSession, chunk: &[u8], sink: &dyn SessionSink) {
    let message = String::from_utf8_lossy(chunk).trim().to_string();
    if message.is_empty() {
        return;
    }
    if is_informational(&message) {
        return;
    }
    let lower = message.to_lowercase();
    if is_trust_not_trusted(&lower) && is_trust_permissions(&lower) {
        sink.on_trust_required(&session.project_path);
        return;
    }
    sink.on_error(AdapterError::Message(message));
}

fn handle_rate_limit_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    if session.is_endpoint_session() {
        return;
    }
    let info = event.get("rate_limit_info");
    let now = chrono::Utc::now().timestamp_millis();
    if let Some(quota) = normalize_rate_limit_event(info, now) {
        sink.on_provider_quota("claude", quota);
    }
}

fn handle_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    let ty = event.get("type").and_then(Value::as_str);
    tracing::debug!(
        session_id = %session.id,
        r#type = ?ty,
        subtype = ?event.get("subtype"),
        "claude event"
    );
    match ty {
        Some("system") => handle_system_event(session, event, sink),
        Some("assistant") => handle_assistant_event(session, event, sink),
        Some("user") => handle_user_event(session, event, sink),
        Some("control_request") => handle_control_request_event(event, sink),
        Some("control_cancel_request") => handle_control_cancel_request_event(event, sink),
        Some("control_response") => handle_control_response_event(session, event, sink),
        Some("rate_limit_event") => handle_rate_limit_event(session, event, sink),
        Some("stream_event") => {
            crate::partial_stream::handle_stream_event(session, event, sink);
        }
        Some("result") => {
            if event
                .get("parent_tool_use_id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .is_some()
            {
                tracing::debug!(
                    session_id = %session.id,
                    "claude: skipping subagent result event (parent_tool_use_id present)"
                );
                return;
            }
            handle_result_event(session, event, sink);
        }
        _ => {
            tracing::debug!(
                session_id = %session.id,
                r#type = ?ty,
                "claude: unhandled event type"
            );
        }
    }
}

#[cfg(test)]
#[path = "events_tests/support.rs"]
mod tests;

#[path = "event_system.rs"]
mod event_system;
use event_system::*;
#[path = "event_control.rs"]
mod event_control;
pub(crate) use event_control::handle_control_response_event;
use event_control::{handle_control_cancel_request_event, handle_control_request_event};
#[path = "event_result.rs"]
mod event_result;
use event_result::*;
