//! `switch_provider`: continue a chat on another provider. The switch kills
//! the current CLI and spawns nothing; the next send spawns the target
//! (fresh, or resuming its earlier native session) and carries the handoff.
use super::*;

use mainframe_types::segment::{SegmentLayout, SwitchCommit, SwitchProviderRequest};

use crate::segments::divider::{divider_for, divider_id};
use crate::segments::switch_plan::{SwitchPlanInput, plan_switch};
use crate::segments::switch_rules::{SwitchCheck, SwitchError, check_switch_allowed};

enum SwitchOutcome {
    Done(Box<Chat>),
    /// No native session has started yet: an ordinary config edit.
    BeforeFirstMessage,
}

impl ChatManager {
    pub async fn switch_provider(
        &self,
        chat_id: &str,
        req: &SwitchProviderRequest,
    ) -> Result<Chat, SwitchError> {
        let outcome = {
            let _config = self.config.lock_changes(chat_id).await;
            self.check_switch(chat_id, req)?;
            // Exclusive with sends, loads and spawns, like an idle offload;
            // a send that arrives meanwhile waits for the release.
            if !self.lifecycle.try_claim_offload(chat_id) {
                return Err(SwitchError::TurnInFlight);
            }
            let outcome = self.switch_claimed(chat_id, req).await;
            self.lifecycle.release_offload(chat_id);
            outcome?
        };
        match outcome {
            SwitchOutcome::Done(chat) => Ok(*chat),
            SwitchOutcome::BeforeFirstMessage => {
                self.update_chat_config(
                    chat_id,
                    Some(req.adapter_id.clone()),
                    req.model.clone(),
                    None,
                    None,
                )
                .await
                .map_err(|e| SwitchError::Failed(e.to_string()))?;
                self.get_chat(chat_id)
                    .ok_or_else(|| SwitchError::NotFound(chat_id.to_string()))
            }
        }
    }

    /// The refusal table, on fresh (enriched) state.
    fn check_switch(
        &self,
        chat_id: &str,
        req: &SwitchProviderRequest,
    ) -> Result<Chat, SwitchError> {
        let chat = self
            .get_chat(chat_id)
            .ok_or_else(|| SwitchError::NotFound(chat_id.to_string()))?;
        let target = self.deps.adapter_info(&req.adapter_id);
        let from_name = self.deps.adapter_fork_info(&chat.adapter_id).name;
        let queued = queued_for_chat(&self.queued_refs, chat_id).len();
        check_switch_allowed(&SwitchCheck {
            chat: &chat,
            target_id: &req.adapter_id,
            target: target.as_ref(),
            model: req.model.as_deref(),
            queued,
            from_name: &from_name,
        })?;
        Ok(chat)
    }

    async fn switch_claimed(
        &self,
        chat_id: &str,
        req: &SwitchProviderRequest,
    ) -> Result<SwitchOutcome, SwitchError> {
        self.lifecycle.await_starting(chat_id).await;
        let chat = self.check_switch(chat_id, req)?;
        if req.adapter_id == chat.adapter_id {
            return Ok(SwitchOutcome::Done(Box::new(chat)));
        }
        let store = self
            .deps
            .segment_store()
            .ok_or_else(|| SwitchError::Failed("Provider switching is unavailable".into()))?;
        if !store.has_native_id(chat_id) {
            return Ok(SwitchOutcome::BeforeFirstMessage);
        }
        let layout = store
            .layout(chat_id)
            .ok_or_else(|| SwitchError::NotFound(chat_id.to_string()))?;
        let commit = self.plan_commit(&chat, &layout, req)?;
        self.detach_session(chat_id).await;
        let layout = store.commit_switch(&commit).map_err(SwitchError::Failed)?;
        let chat = self.apply_switch(chat_id, &commit, &layout)?;
        Ok(SwitchOutcome::Done(Box::new(chat)))
    }

    fn plan_commit(
        &self,
        chat: &Chat,
        layout: &SegmentLayout,
        req: &SwitchProviderRequest,
    ) -> Result<SwitchCommit, SwitchError> {
        let caps = self
            .deps
            .adapter_info(&req.adapter_id)
            .map(|a| a.capabilities);
        let default_model = self
            .deps
            .settings_get("provider", &format!("{}.defaultModel", req.adapter_id));
        let now = now_iso8601();
        let new_segment_id = format!("seg_{}", nanoid::nanoid!());
        let new_native_id = format!("ns_{}", nanoid::nanoid!());
        plan_switch(&SwitchPlanInput {
            chat,
            layout,
            target_adapter: &req.adapter_id,
            requested_model: req.model.as_deref(),
            requested_tuning: req.tuning.as_ref(),
            default_model: default_model.as_deref(),
            target_auto_mode: caps.is_some_and(|c| c.auto_mode),
            target_plan_mode: caps.is_some_and(|c| c.plan_mode),
            now: &now,
            new_segment_id: &new_segment_id,
            new_native_id: &new_native_id,
        })
        .ok_or_else(|| SwitchError::Failed(format!("Chat {} has no active segment", chat.id)))
    }

    /// Kills the CLI if one is spawned; the next send spawns the target.
    async fn detach_session(&self, chat_id: &str) {
        let session = self.get_active(chat_id).and_then(|cell| {
            cell.lock()
                .unwrap_or_else(|e| e.into_inner())
                .session
                .take()
        });
        if let Some(session) = session
            && let Err(err) = session.kill().await
        {
            tracing::warn!(?err, chat_id, "provider switch: failed to stop the session");
        }
    }

    /// Mirrors the committed row into the live cell and the message cache:
    /// the deleted pending segment's divider goes, the new one is appended.
    fn apply_switch(
        &self,
        chat_id: &str,
        commit: &SwitchCommit,
        layout: &SegmentLayout,
    ) -> Result<Chat, SwitchError> {
        let fresh = self
            .deps
            .chats_get(chat_id)
            .ok_or_else(|| SwitchError::NotFound(chat_id.to_string()))?;
        if let Some(cell) = self.get_active(chat_id) {
            cell.lock().unwrap_or_else(|e| e.into_inner()).chat = fresh;
        }
        let changed = self.apply_divider_changes(chat_id, commit, layout);
        if changed {
            self.event_handler.emit_display(chat_id);
        }
        let chat = self
            .get_chat(chat_id)
            .ok_or_else(|| SwitchError::NotFound(chat_id.to_string()))?;
        self.emit(DaemonEvent::ChatUpdated {
            chat: chat.clone(),
            reason: None,
        });
        Ok(chat)
    }

    fn apply_divider_changes(
        &self,
        chat_id: &str,
        commit: &SwitchCommit,
        layout: &SegmentLayout,
    ) -> bool {
        let mut messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
        // A cold chat composes its dividers on load; only a warm cache is edited.
        if messages.get(chat_id).is_none_or(Vec::is_empty) {
            return false;
        }
        let mut changed = false;
        if let Some(pending) = &commit.delete_pending {
            changed |= messages.remove_by_id(chat_id, &divider_id(&pending.segment_id));
        }
        if let Some(open) = &commit.open_segment {
            let name_of = |id: &str| self.deps.adapter_fork_info(id).name;
            if let Some(divider) = divider_for(chat_id, layout, &open.id, &name_of) {
                messages.append(chat_id, divider);
                changed = true;
            }
        }
        changed
    }
}
