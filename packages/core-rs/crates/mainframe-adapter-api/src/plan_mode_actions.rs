//! The `PlanModeActionHandler` / `PlanActionContext` pair lives in
//! `mainframe-adapter-api` rather than in the chat crate so adapters never
//! depend on `mainframe-chat`: adapters *implement* `PlanModeActionHandler`, and
//! `mainframe-chat` *consumes* it by implementing `PlanActionContext`.
//!
//! Because `mainframe-adapter-api` must not depend on the chat/db crates, the
//! context's chat/db/messages/permissions/session accesses are trait methods
//! that `mainframe-chat` fulfills.

use mainframe_types::adapter::ControlResponse;
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;

use crate::{AdapterError, BoxFuture};

/// Partial chat patch the plan-mode handlers apply — the fields the handlers
/// both mutate on the in-memory chat and persist to the chats table.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PlanChatUpdate {
    pub plan_mode: Option<bool>,
    pub permission_mode: Option<ExecutionMode>,
    /// Forget the provider's session id so the next spawn starts fresh (the
    /// clear-context path).
    pub clear_vendor_session_id: bool,
}

/// The chat state a plan-mode handler drives. `mainframe-chat` implements it
/// over its active chat, message cache, permission queue and database; the
/// adapter side only sees these methods.
pub trait PlanActionContext: Send + Sync {
    fn chat_id(&self) -> String;

    /// Persist the update, mirror it in memory, and emit `chat.updated`.
    fn update_chat(&self, patch: PlanChatUpdate) -> Result<(), AdapterError>;
    fn emit_event(&self, event: DaemonEvent);

    /// Whether the chat has a live, spawned session.
    fn session_is_spawned(&self) -> bool;
    fn session_set_permission_mode(
        &self,
        mode: ExecutionMode,
    ) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn session_respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn session_kill(&self) -> BoxFuture<'_, Result<(), AdapterError>>;
    /// Detach the chat's session.
    fn clear_active_session(&self);

    /// Drop the plan gate being answered from the front of the pending queue.
    fn permissions_shift(&self);
    /// The most recent plan file named in the chat's cached messages.
    fn recover_latest_plan_file(&self) -> Option<String>;
    /// Record `path` as one of the chat's plan files; `true` when it was new.
    fn add_plan_file(&self, path: String) -> bool;
    /// Empty the chat's cached messages.
    fn clear_messages(&self);
    fn clear_display_state(&self);
    /// Announce the wipe on the chat-surface seam — the facade pushes
    /// `_mainframe.dev/transcript_cleared` so attached clients re-resume.
    fn notify_transcript_cleared(&self);
    fn start_chat(&self) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn send_message(&self, content: String) -> BoxFuture<'_, Result<(), AdapterError>>;
}

/// The adapter-generic half of "approve the plan, then clear context": leave plan
/// mode, drop the vendor session id so the next spawn is a fresh one, wipe the
/// transcript on every seam, and restart the chat with the approved plan as its
/// first prompt. Each adapter owns only what precedes it — answering the pending
/// gate and tearing down its CLI.
pub async fn clear_context_and_restart(
    response: &ControlResponse,
    ctx: &dyn PlanActionContext,
) -> Result<(), AdapterError> {
    ctx.update_chat(PlanChatUpdate {
        plan_mode: Some(false),
        permission_mode: Some(response.execution_mode.unwrap_or(ExecutionMode::Default)),
        clear_vendor_session_id: true,
    })?;

    ctx.clear_messages();
    ctx.clear_display_state();
    ctx.notify_transcript_cleared();

    ctx.start_chat().await?;
    if let Some(plan) = approved_plan(response) {
        ctx.send_message(format!("Implement the following plan:\n\n{plan}"))
            .await?;
    }
    Ok(())
}

fn approved_plan(response: &ControlResponse) -> Option<String> {
    response
        .updated_input
        .as_ref()?
        .get("plan")?
        .as_str()
        .map(str::to_string)
}

/// Per-adapter plan-mode action strategy. Claude and Codex implement it; the
/// chat layer calls it with a `PlanActionContext`.
pub trait PlanModeActionHandler: Send + Sync {
    /// User approved the plan WITHOUT clearing context.
    fn on_approve<'a>(
        &'a self,
        response: ControlResponse,
        context: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>>;

    /// User approved AND checked "Clear Context".
    fn on_approve_and_clear_context<'a>(
        &'a self,
        response: ControlResponse,
        context: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>>;

    /// User rejected the plan.
    fn on_reject<'a>(
        &'a self,
        response: ControlResponse,
        context: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>>;

    /// User provided revision feedback (forwarded as free-form text).
    fn on_revise<'a>(
        &'a self,
        feedback: String,
        response: ControlResponse,
        context: &'a dyn PlanActionContext,
    ) -> BoxFuture<'a, Result<(), AdapterError>>;
}
