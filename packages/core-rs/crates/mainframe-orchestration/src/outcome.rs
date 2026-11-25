//! How a delegated task ended.

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::orchestration::TaskStatus;

use crate::errors::cap_chars;
use crate::policy::{ERROR_MESSAGE_CAP, SUMMARY_CAP};
use crate::state::last_assistant_text;

/// How a terminal task ended, and what the parent is told.
pub(crate) struct Outcome {
    pub status: TaskStatus,
    pub summary: Option<String>,
    pub error: Option<String>,
}

impl Outcome {
    /// An ending with nothing to summarize, only a reason.
    pub(crate) fn without_summary(status: TaskStatus, error: &str) -> Self {
        Self {
            status,
            summary: None,
            error: Some(error.to_string()),
        }
    }
}

/// What a finished child reports: a failed last turn leads with its error.
pub(crate) fn idle_outcome(messages: &[ChatMessage]) -> Outcome {
    let summary =
        Some(cap_chars(&last_assistant_text(messages), SUMMARY_CAP)).filter(|s| !s.is_empty());
    let error = messages
        .last()
        .filter(|m| m.r#type == ChatMessageType::Error)
        .map(error_text);
    Outcome {
        status: match error {
            Some(_) => TaskStatus::Failed,
            None => TaskStatus::Completed,
        },
        summary,
        error,
    }
}

fn error_text(message: &ChatMessage) -> String {
    let lines: Vec<&str> = message
        .content
        .iter()
        .filter_map(|block| match block {
            MessageContent::Node(MessageContentNode::Error { message, .. }) => {
                Some(message.as_str())
            }
            _ => None,
        })
        .collect();
    cap_chars(&lines.join("\n"), ERROR_MESSAGE_CAP)
}
