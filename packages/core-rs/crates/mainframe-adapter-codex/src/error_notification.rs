//! The `error` notification: while Codex reconnects after a dropped response
//! stream it sends `willRetry: true` errors (`Reconnecting... 2/5`), the only
//! live sign that the turn is not frozen. Those become one retry on the
//! session sink. A `willRetry: false` error repeats what `turn/completed`
//! carries next, so it produces nothing.

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use mainframe_types::acp::extensions::attempt_fraction;
use serde_json::Value;

use crate::event_mapper::{Owner, resolve_owner};
use crate::notification_types::ErrorNotificationParams;
use crate::session_state::CodexSessionState;

pub(crate) fn handle_error_notification(
    params: &Value,
    sink: &Arc<dyn SessionSink>,
    state: &CodexSessionState,
) {
    let params = match serde_json::from_value::<ErrorNotificationParams>(params.clone()) {
        Ok(params) => params,
        Err(err) => {
            tracing::warn!(chat_id = %state.mainframe_chat_id, error = %err, "malformed error notification");
            return;
        }
    };
    if !params.will_retry {
        return;
    }
    // The status belongs to the chat, so a child thread's retry goes to the
    // unwrapped sink: a `ParentIdSink` would drop it.
    if matches!(
        resolve_owner(params.thread_id.as_deref(), state),
        Owner::Unknown
    ) {
        tracing::debug!(chat_id = %state.mainframe_chat_id, "dropping retry from an unregistered thread");
        return;
    }
    let message = params.error.message.trim();
    let attempt = attempt_fraction(message).map_or(0, |(attempt, _)| attempt);
    sink.on_api_retry(
        attempt,
        retry_reason(message, &params.error.additional_details),
    );
}

/// The message, plus `additionalDetails` when it is non-empty text.
fn retry_reason(message: &str, details: &Option<Value>) -> Option<String> {
    let details = details
        .as_ref()
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|d| !d.is_empty());
    match (message.is_empty(), details) {
        (false, Some(d)) => Some(format!("{message}\n{d}")),
        (false, None) => Some(message.to_string()),
        (true, Some(d)) => Some(d.to_string()),
        (true, None) => None,
    }
}
