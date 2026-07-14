//! Narrow ChatManager seam for the agent port (Node agent-port.ts
//! `ChatPortDeps` structural subset) — fakeable in unit tests without a full
//! `ChatManagerDeps` graph.

use std::sync::Arc;

use mainframe_automations::engine::BoxFuture;
use mainframe_chat::chat_manager::ChatManager;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;

pub trait AgentChatPort: Send + Sync {
    /// `createChatWithDefaults` → the new chat id. `branch_name` rides the
    /// create so the chat row carries it from birth (v1 agent-port parity).
    /// `automation_run_id` stamps the chat as automation-created so the
    /// sessions sidebar hides it from the default list.
    #[allow(clippy::too_many_arguments)]
    fn create_chat<'a>(
        &'a self,
        project_id: &'a str,
        adapter_id: &'a str,
        model: Option<&'a str>,
        permission_mode: Option<&'a str>,
        branch_name: Option<&'a str>,
        automation_run_id: &'a str,
    ) -> BoxFuture<'a, String>;
    fn enable_worktree<'a>(
        &'a self,
        chat_id: &'a str,
        base_branch: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, Result<(), String>>;
    fn send_message<'a>(
        &'a self,
        chat_id: &'a str,
        content: &'a str,
    ) -> BoxFuture<'a, Result<(), String>>;
    /// The last assistant text block — the step's `result` output and the A2
    /// parse input (mirrors `get_last_assistant_text`, without the push cap).
    fn last_assistant_text<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, String>;
    /// Best-effort session stop (run-cancel sweep).
    fn interrupt<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
}

pub struct ChatManagerPort {
    chats: Arc<ChatManager>,
}

impl ChatManagerPort {
    pub fn new(chats: Arc<ChatManager>) -> Self {
        Self { chats }
    }
}

impl AgentChatPort for ChatManagerPort {
    fn create_chat<'a>(
        &'a self,
        project_id: &'a str,
        adapter_id: &'a str,
        model: Option<&'a str>,
        permission_mode: Option<&'a str>,
        branch_name: Option<&'a str>,
        automation_run_id: &'a str,
    ) -> BoxFuture<'a, String> {
        Box::pin(async move {
            self.chats
                .create_chat_with_defaults(
                    project_id,
                    adapter_id,
                    model,
                    permission_mode,
                    None,
                    branch_name,
                    Some(automation_run_id),
                )
                .await
                .id
        })
    }

    fn enable_worktree<'a>(
        &'a self,
        chat_id: &'a str,
        base_branch: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            self.chats
                .enable_worktree(chat_id, base_branch, branch_name)
                .await
                .map_err(|err| err.to_string())
        })
    }

    fn send_message<'a>(
        &'a self,
        chat_id: &'a str,
        content: &'a str,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            self.chats
                .send_message(chat_id, content, None, None)
                .await
                .map_err(|err| err.to_string())
        })
    }

    fn last_assistant_text<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, String> {
        Box::pin(async move { last_assistant_text(&self.chats.get_messages(chat_id).await) })
    }

    fn interrupt<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.chats.interrupt_chat(chat_id).await })
    }
}

/// The last non-empty assistant text block (event_handler.rs
/// `get_last_assistant_text` semantics, minus the push-body length cap —
/// the engine needs the full text for A2 parsing).
pub(crate) fn last_assistant_text(messages: &[ChatMessage]) -> String {
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

// PORT STATUS: packages/core/src/automations/agent-port.ts (ChatPortDeps)
// confidence: high
// todos: 0
// notes: —
