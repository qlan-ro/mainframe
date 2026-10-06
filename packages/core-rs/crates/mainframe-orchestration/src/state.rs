//! Adapter-neutral chat state and the agent-message markers.

use mainframe_types::chat::{ChatMessage, ChatMessageType, ChatStatus, MessageContent};
use mainframe_types::content::LeafContent;
use serde::Serialize;

use crate::ports::ChatView;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatState {
    Idle,
    Working,
    WaitingForPermission,
    Ended,
    Archived,
}

impl ChatState {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Working => "working",
            Self::WaitingForPermission => "waiting_for_permission",
            Self::Ended => "ended",
            Self::Archived => "archived",
        }
    }
}

/// First match wins: archived, ended, a pending gate, any work in flight
/// (a live turn, CLI-queued prompts, or Mainframe-held outbox entries), idle.
#[must_use]
pub fn derive_state(chat: &ChatView, outbox_pending: bool) -> ChatState {
    match chat.status {
        ChatStatus::Archived => ChatState::Archived,
        ChatStatus::Ended => ChatState::Ended,
        _ if chat.pending_permission.is_some() => ChatState::WaitingForPermission,
        _ if chat.working || outbox_pending => ChatState::Working,
        _ => ChatState::Idle,
    }
}

/// Whole-message marker kinds. The marker is part of the message text, so it
/// survives a transcript reload and `chat_read` can tell agent-sent messages
/// from the user's own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentMessageKind {
    Send,
    Launch,
    Task,
}

impl AgentMessageKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Send => "send",
            Self::Launch => "launch",
            Self::Task => "task",
        }
    }
}

pub const AGENT_MESSAGE_OPEN: &str = "<mainframe-agent-message ";
pub const AGENT_MESSAGE_CLOSE: &str = "</mainframe-agent-message>";
pub const TASK_RESULT_OPEN: &str = "<mainframe-task-result ";

#[must_use]
pub fn wrap_agent_message(from_chat_id: &str, kind: AgentMessageKind, body: &str) -> String {
    format!(
        "{AGENT_MESSAGE_OPEN}from=\"{from_chat_id}\" kind=\"{}\">\n{body}\n{AGENT_MESSAGE_CLOSE}",
        kind.as_str()
    )
}

/// True for a user message an agent (not the human) sent.
#[must_use]
pub fn is_agent_message(text: &str) -> bool {
    let trimmed = text.trim_start();
    trimmed.starts_with(AGENT_MESSAGE_OPEN) || trimmed.starts_with(TASK_RESULT_OPEN)
}

/// The last non-empty assistant text block, or `""` when there is none. Task
/// summaries, `chat_wait`, and the automations engine's step output all read
/// a chat's answer this way.
#[must_use]
pub fn last_assistant_text(messages: &[ChatMessage]) -> String {
    for message in messages.iter().rev() {
        if message.r#type != ChatMessageType::Assistant {
            continue;
        }
        for block in message.content.iter().rev() {
            if let MessageContent::Leaf(LeafContent::Text { text, .. }) = block {
                let text = text.trim();
                if !text.is_empty() {
                    return text.to_string();
                }
            }
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::chat_view;

    #[test]
    fn state_derivation_takes_the_first_match() {
        let mut chat = chat_view("c");
        assert_eq!(derive_state(&chat, false), ChatState::Idle);
        assert_eq!(derive_state(&chat, true), ChatState::Working);
        chat.working = true;
        assert_eq!(derive_state(&chat, false), ChatState::Working);
        chat.pending_permission = Some(crate::ports::PendingPermissionView {
            tool_name: "Bash".into(),
            summary: String::new(),
        });
        assert_eq!(derive_state(&chat, false), ChatState::WaitingForPermission);
        chat.status = ChatStatus::Ended;
        assert_eq!(derive_state(&chat, false), ChatState::Ended);
        chat.status = ChatStatus::Archived;
        assert_eq!(derive_state(&chat, false), ChatState::Archived);
    }

    #[test]
    fn agent_messages_are_recognized_by_their_marker() {
        let wrapped = wrap_agent_message("abc", AgentMessageKind::Send, "hello");
        assert!(wrapped.starts_with("<mainframe-agent-message from=\"abc\" kind=\"send\">"));
        assert!(is_agent_message(&wrapped));
        assert!(!is_agent_message("hello"));
    }
}
