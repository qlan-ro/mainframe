//! Tool-level failures and the MCP `tools/call` result envelope.
//!
//! Every failure except an unknown tool name is a *tool result* with
//! `isError: true`, so the model reads it and can correct itself. Internal
//! errors never reach the model verbatim: they are logged and replaced by a
//! generic public message.

use std::fmt;

use serde_json::{Value, json};

use crate::policy::{ERROR_MESSAGE_CAP, RESULT_BUDGET_BYTES};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    InvalidRequest,
    ChatNotFound,
    ProjectNotFound,
    TaskNotFound,
    CallerNotActive,
    PermissionModeEscalationDenied,
    PlanModeEscalationDenied,
    AdapterUnavailable,
    ModelUnavailable,
    ChatNotSendable,
    NoActiveTurn,
    NotSteerable,
    InvalidCursor,
    WorkspaceInvalid,
    DepthLimitExceeded,
    TaskLimitExceeded,
    RateLimited,
    OrchestrationError,
}

impl ErrorCode {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid_request",
            Self::ChatNotFound => "chat_not_found",
            Self::ProjectNotFound => "project_not_found",
            Self::TaskNotFound => "task_not_found",
            Self::CallerNotActive => "caller_not_active",
            Self::PermissionModeEscalationDenied => "permission_mode_escalation_denied",
            Self::PlanModeEscalationDenied => "plan_mode_escalation_denied",
            Self::AdapterUnavailable => "adapter_unavailable",
            Self::ModelUnavailable => "model_unavailable",
            Self::ChatNotSendable => "chat_not_sendable",
            Self::NoActiveTurn => "no_active_turn",
            Self::NotSteerable => "not_steerable",
            Self::InvalidCursor => "invalid_cursor",
            Self::WorkspaceInvalid => "workspace_invalid",
            Self::DepthLimitExceeded => "depth_limit_exceeded",
            Self::TaskLimitExceeded => "task_limit_exceeded",
            Self::RateLimited => "rate_limited",
            Self::OrchestrationError => "orchestration_error",
        }
    }
}

/// A failure the model is allowed to read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolError {
    pub code: ErrorCode,
    pub message: String,
}

impl ToolError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: cap_chars(&message.into(), ERROR_MESSAGE_CAP),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidRequest, message)
    }

    /// Logs the detail and hands the model only the generic reason, so
    /// storage, IO, and adapter internals never leak into a transcript.
    pub fn internal(detail: impl fmt::Display) -> Self {
        tracing::error!(%detail, "orchestration port failure");
        Self::new(
            ErrorCode::OrchestrationError,
            "The operation could not be completed.",
        )
    }
}

impl fmt::Display for ToolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

/// A port failure: either a reason the model may read, or an internal one
/// that [`ToolError::internal`] logs and hides.
#[derive(Debug)]
pub enum PortError {
    Public(ToolError),
    Internal(String),
}

impl From<PortError> for ToolError {
    fn from(err: PortError) -> Self {
        match err {
            PortError::Public(err) => err,
            PortError::Internal(detail) => ToolError::internal(detail),
        }
    }
}

impl From<ToolError> for PortError {
    fn from(err: ToolError) -> Self {
        Self::Public(err)
    }
}

/// Cuts `text` to at most `max` characters on a char boundary.
#[must_use]
pub fn cap_chars(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((idx, _)) => text[..idx].to_string(),
        None => text.to_string(),
    }
}

/// The success envelope. Claude shows `structuredContent` in place of the text
/// when both exist, so both carry the same object.
#[must_use]
pub(crate) fn tool_success(result: Value) -> Value {
    let text = result.to_string();
    if text.len() > RESULT_BUDGET_BYTES {
        // Tools budget their own output; reaching this means a tool forgot to,
        // and an oversized result would be moved to a file by the client.
        tracing::warn!(bytes = text.len(), "orchestration tool result over budget");
    }
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": result,
        "isError": false,
    })
}

#[must_use]
pub(crate) fn tool_failure(err: &ToolError) -> Value {
    json!({
        "content": [{ "type": "text", "text": err.to_string() }],
        "structuredContent": {
            "error": { "code": err.code.as_str(), "message": err.message }
        },
        "isError": true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_message_is_capped_at_1000_chars() {
        let err = ToolError::invalid("x".repeat(5000));
        assert_eq!(err.message.chars().count(), ERROR_MESSAGE_CAP);
    }

    #[test]
    fn internal_errors_do_not_leak_their_detail() {
        let err: ToolError = PortError::Internal("sqlite: disk I/O at /secret".into()).into();
        assert_eq!(err.code, ErrorCode::OrchestrationError);
        assert!(!err.message.contains("secret"));
        let envelope = tool_failure(&err);
        assert_eq!(envelope["isError"], true);
        assert!(!envelope.to_string().contains("secret"));
    }

    #[test]
    fn success_envelope_carries_text_and_structured_content() {
        let envelope = tool_success(json!({ "a": 1 }));
        assert_eq!(envelope["structuredContent"]["a"], 1);
        assert_eq!(envelope["content"][0]["text"], "{\"a\":1}");
        assert_eq!(envelope["isError"], false);
    }

    #[test]
    fn cap_chars_respects_multibyte_boundaries() {
        assert_eq!(cap_chars("héllo", 2), "hé");
        assert_eq!(cap_chars("hi", 10), "hi");
    }
}
