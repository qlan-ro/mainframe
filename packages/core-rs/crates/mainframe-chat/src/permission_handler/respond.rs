//! `respond_to_permission`: the guards every answer passes (cancelled,
//! stale/duplicate, no live session) and the branch it lands on. Split out of
//! `permission_handler.rs` — a pure move; the branches themselves live in
//! `branches.rs`.

use mainframe_types::adapter::{ControlBehavior, ControlResponse, ControlUpdate};
use mainframe_types::chat::ChatMessageType;
use mainframe_types::sync::LockExt as _;
use tracing::{info, warn};

use super::{ChatPermissionHandler, PermissionError, is_exit_plan_mode};

impl ChatPermissionHandler {
    pub async fn respond_to_permission(
        &self,
        chat_id: &str,
        mut response: ControlResponse,
    ) -> Result<(), PermissionError> {
        if self.response_was_cancelled(chat_id, &response) {
            return Ok(());
        }

        let active = self.shared.active(chat_id);

        if self.response_is_stale(chat_id, &response, active.as_ref()) {
            return Ok(());
        }

        // Every client's answer passes here, so no client can save more than this.
        let withheld = response.withhold_ungrantable();
        self.forward_response(chat_id, response, active).await?;
        if !withheld.is_empty() {
            self.report_withheld(chat_id, &withheld);
        }
        Ok(())
    }

    async fn forward_response(
        &self,
        chat_id: &str,
        response: ControlResponse,
        active: Option<std::sync::Arc<std::sync::Mutex<crate::types::ActiveChat>>>,
    ) -> Result<(), PermissionError> {
        let spawned = active.as_ref().is_some_and(Self::session_spawned);
        if !spawned {
            warn!(
                chat_id,
                request_id = response.request_id,
                tool_name = ?response.tool_name,
                behavior = ?response.behavior,
                "no active session, will start fresh"
            );
            return self
                .handle_no_session_permission(chat_id, response, active)
                .await;
        }
        let Some(active) = active else {
            return Ok(()); // `spawned` implies `Some`; defensive early-out
        };

        info!(
            chat_id,
            request_id = response.request_id,
            tool_name = ?response.tool_name,
            behavior = ?response.behavior,
            "forwarding to session"
        );

        if let Some(text) = &response.message {
            let message = self.transient_text(chat_id, ChatMessageType::User, text);
            self.shared.messages.lock_recover().append(chat_id, message);
            self.event_handler.emit_display(chat_id);
        }

        if response.clear_context == Some(true)
            && response.behavior == ControlBehavior::Allow
            && is_exit_plan_mode(&response)
        {
            return self
                .handle_clear_context_permission(chat_id, active, response)
                .await;
        }

        self.handle_normal_permission(chat_id, active, response)
            .await
    }

    /// A line in the session for what the answer asked to save and did not.
    fn report_withheld(&self, chat_id: &str, withheld: &[ControlUpdate]) {
        let what: Vec<String> = withheld.iter().map(ControlUpdate::withheld_label).collect();
        let what = what.join("; ");
        warn!(chat_id, withheld = what, "permission answer narrowed");
        let text = format!("Not saved with the permission answer: {what}.");
        let message = self.transient_text(chat_id, ChatMessageType::System, &text);
        self.shared.messages.lock_recover().append(chat_id, message);
        self.event_handler.emit_display(chat_id);
    }

    fn response_was_cancelled(&self, chat_id: &str, response: &ControlResponse) -> bool {
        if self
            .shared
            .permissions
            .lock_recover()
            .was_cancelled(chat_id, &response.request_id)
        {
            info!(
                chat_id,
                request_id = response.request_id,
                "request was cancelled by the CLI, dropping the answer"
            );
            return true;
        }

        false
    }
    fn response_is_stale(
        &self,
        chat_id: &str,
        response: &ControlResponse,
        active: Option<&std::sync::Arc<std::sync::Mutex<crate::types::ActiveChat>>>,
    ) -> bool {
        // Guard: reject stale/duplicate responses (only when a permission is queued).
        if let Some(cell) = active {
            let matches_pending = self
                .shared
                .permissions
                .lock_recover()
                .matches_pending(chat_id, &response.request_id);
            if Self::session_spawned(cell) && self.has_pending(chat_id) && !matches_pending {
                warn!(
                    chat_id,
                    request_id = response.request_id,
                    "requestId does not match pending, ignoring stale response"
                );
                return true;
            }
        }

        false
    }
}
