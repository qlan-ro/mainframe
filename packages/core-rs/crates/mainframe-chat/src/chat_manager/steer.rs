//! Steering: a message folded into a chat's running turn (the orchestration
//! MCP server's `chat_send` in `steer` mode). It is stored and displayed like
//! any other user message; only the adapter call differs.
use super::*;
use mainframe_types::sync::LockExt as _;

impl ChatManager {
    /// Delivers `content` into `chat_id`'s active turn at the adapter's next
    /// safe boundary. Fails when the chat has no live, working session or its
    /// adapter cannot steer; the caller then queues instead.
    pub async fn steer_message(&self, chat_id: &str, content: &str) -> Result<(), SendError> {
        let (post, session) = self.require_live_session(chat_id)?;
        if !session.supports_steer() {
            return Err(SendError(format!(
                "Chat {chat_id}'s adapter cannot steer a running turn"
            )));
        }
        let working = post.lock_recover().chat.process_state == Some(Some(ProcessState::Working));
        if !working {
            return Err(SendError(format!("Chat {chat_id} has no active turn")));
        }
        info!(chat_id, "steer message sent");
        self.send_plain_text(&post, &session, chat_id, content, None, Delivery::Steer)
            .await
    }
}
