//! Ported (RELOCATED) from `packages/core/src/chat/plan-mode-actions.ts`.
//!
//! ORCHESTRATOR RELOCATION (crate-map amendment recorded in PORTING.md §2.10):
//! the TS `PlanModeActionHandler` / `PlanActionContext` pair lived in the `chat`
//! module, which forced an adapter→chat layering inversion (the claude/codex
//! adapters imported `chat/plan-mode-actions`). Moving the pair into
//! `mainframe-adapter-api` reverses the dependency: adapters *implement*
//! `PlanModeActionHandler`, and `mainframe-chat` *consumes* it by implementing
//! `PlanActionContext`.
//!
//! Shape note (faithful-but-relocated): the TS `PlanActionContext` is an object
//! bag exposing `chat`/`db`/`messages`/`permissions`/`active.session` directly.
//! Because `mainframe-adapter-api` must not depend on the chat/db crates, those
//! field accesses become trait methods that `mainframe-chat` fulfills. The
//! handler's control flow (order of operations, early returns) is preserved
//! line-for-line against the TS source.

use mainframe_types::adapter::ControlResponse;
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;

use crate::{AdapterError, BoxFuture};

/// Partial chat patch the plan-mode handlers apply — mirrors the fields the TS
/// handlers both mutate on `ctx.chat` and pass to `ctx.db.chats.update`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PlanChatUpdate {
    pub plan_mode: Option<bool>,
    pub permission_mode: Option<ExecutionMode>,
    /// The clear-context path sets `claudeSessionId = undefined`.
    pub clear_claude_session_id: bool,
}

/// The capability bag a plan-mode handler drives (relocated `PlanActionContext`).
/// `mainframe-chat` implements this over its `ActiveChat` / `MessageCache` /
/// `PermissionManager` / `DatabaseManager` state; the adapter side only sees
/// these methods.
pub trait PlanActionContext: Send + Sync {
    fn chat_id(&self) -> String;

    /// Mutate the in-memory `Chat` and persist via `db.chats.update` (mirrors the
    /// TS `ctx.chat.X = ...; ctx.db.chats.update(chatId, patch)` pair).
    fn update_chat(&self, patch: PlanChatUpdate);
    /// `ctx.emitEvent({ type: 'chat.updated', chat: ctx.chat })`.
    fn emit_chat_updated(&self);
    fn emit_event(&self, event: DaemonEvent);

    /// `ctx.active.session?.isSpawned`.
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
    /// `ctx.active.session = null`.
    fn clear_active_session(&self);

    /// `ctx.permissions.shift(ctx.chatId)`.
    fn permissions_shift(&self);
    /// `extractLatestPlanFileFromMessages(ctx.messages.get(ctx.chatId) ?? [])`.
    fn recover_latest_plan_file(&self) -> Option<String>;
    /// `ctx.db.chats.addPlanFile(ctx.chatId, path)` — returns whether it was new.
    fn add_plan_file(&self, path: String) -> bool;
    /// `ctx.messages.set(ctx.chatId, [])`.
    fn clear_messages(&self);
    fn clear_display_cache(&self);
    fn start_chat(&self) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn send_message(&self, content: String) -> BoxFuture<'_, Result<(), AdapterError>>;
}

/// Per-adapter plan-mode action strategy (relocated `PlanModeActionHandler`).
/// Claude/Codex implement this; the chat layer calls it with a
/// `PlanActionContext`.
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

// PORT STATUS: src/chat/plan-mode-actions.ts (43 lines) — RELOCATED to mainframe-adapter-api
// confidence: high
// todos: 0
// notes: Orchestrator-mandated relocation breaking the adapter→chat inversion.
// notes: TS interface fields (chat/db/messages/permissions/active.session) become
// notes: PlanActionContext trait methods so this crate needs no chat/db dep;
// notes: mainframe-chat implements the trait. PlanModeActionHandler async methods
// notes: return BoxFuture (no async-trait in the workspace). Crate-map row
// notes: chat/plan-mode-actions.ts amended in PORTING.md §2.10 to point here.
