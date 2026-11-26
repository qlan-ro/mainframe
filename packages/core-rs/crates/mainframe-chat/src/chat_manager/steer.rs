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
        // The same gates an ordinary send passes: it must not race an offload, reach
        // a session that is being interrupted, or jump maintenance's queue.
        let _send_guard = self.lifecycle.begin_send(chat_id).await;
        self.lifecycle.wait_for_interrupt(chat_id).await;
        if self.shared.maintenance.active(chat_id)
            || (!self.held_queue_turn_running(chat_id) && self.input_reserved(chat_id)?)
        {
            return Err(SendError::NoActiveTurn(chat_id.to_string()));
        }
        let (post, session) = self.require_live_session(chat_id)?;
        if !session.ready_for_input() {
            return Err(SendError::NoActiveTurn(chat_id.to_string()));
        }
        if !session.supports_steer() {
            return Err(SendError::SteerUnsupported(chat_id.to_string()));
        }
        let working = post.lock_recover().chat.process_state == Some(Some(ProcessState::Working));
        if !working {
            return Err(SendError::NoActiveTurn(chat_id.to_string()));
        }
        info!(chat_id, "steer message sent");
        self.send_plain_text(&post, &session, chat_id, content, None, Delivery::Steer)
            .await
            .map(|_| ())
    }
}
