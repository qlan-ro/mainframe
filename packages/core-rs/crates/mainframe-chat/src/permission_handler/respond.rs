//! `respond_to_permission`: the guards every answer passes (cancelled,
//! stale/duplicate, no live session) and the branch it lands on. Split out of
//! `permission_handler.rs` (todo #350, PR #688 review) — a pure move; the
//! branches themselves live in `branches.rs`.

use mainframe_types::adapter::{ControlBehavior, ControlResponse};
use tracing::{info, warn};

use super::{ChatPermissionHandler, PermissionError, PermissionHandlerDeps, is_exit_plan_mode};

impl<D: PermissionHandlerDeps> ChatPermissionHandler<D> {
    pub async fn respond_to_permission(
        &self,
        chat_id: &str,
        response: ControlResponse,
    ) -> Result<(), PermissionError> {
        if self
            .permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .was_cancelled(chat_id, &response.request_id)
        {
            info!(
                chat_id,
                request_id = response.request_id,
                "respondToPermission: request was cancelled by the CLI, dropping the answer"
            );
            return Ok(());
        }

        let active = self.deps.get_active_chat(chat_id);

        // Guard: reject stale/duplicate responses (only when a permission is queued).
        if let Some(cell) = &active {
            let matches_pending = self
                .permissions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .matches_pending(chat_id, &response.request_id);
            if Self::session_spawned(cell) && self.has_pending(chat_id) && !matches_pending {
                warn!(
                    chat_id,
                    request_id = response.request_id,
                    "respondToPermission: requestId does not match pending, ignoring stale response"
                );
                return Ok(());
            }
        }

        let spawned = active.as_ref().is_some_and(Self::session_spawned);
        if !spawned {
            warn!(
                chat_id,
                request_id = response.request_id,
                tool_name = ?response.tool_name,
                behavior = ?response.behavior,
                "respondToPermission: no active session, will start fresh"
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
            "respondToPermission: forwarding to session"
        );

        if let Some(text) = &response.message {
            let message = self.transient_user_text(chat_id, text);
            let evicted = self
                .messages
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .append(chat_id, message);
            crate::event_handler::resync::notify_if_evicted(
                self.chat_surface.get(),
                chat_id,
                evicted,
            );
            self.deps.emit_display(chat_id);
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
}
