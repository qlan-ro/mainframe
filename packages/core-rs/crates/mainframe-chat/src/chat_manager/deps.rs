//! `ChatManagerDeps` — the crate's entire dependency-injection surface.
use super::*;

/// The external dependency surface — everything the daemon injects into the
/// ChatManager (db repos, adapters, attachments, launch, notifications, and the
/// Claude-specific pieces that would otherwise form a crate cycle). `emit_event`
/// is the RAW `onEvent` (chat.updated/created enrichment is applied by the
/// wrappers before this is called).
pub trait ChatManagerDeps: Send + Sync {
    fn emit_event(&self, event: DaemonEvent);
    fn get_tool_categories(&self, chat_id: &str) -> Option<ToolCategories>;
    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage>;
    fn strip_command_tags(&self, text: &str) -> String;

    fn chats_get(&self, id: &str) -> Option<Chat>;
    fn chats_create(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
        automation_run_id: Option<&str>,
    ) -> Chat;
    fn chats_update(&self, chat_id: &str, patch: &ChatUpdate);
    fn chats_list(&self, project_id: &str) -> Vec<Chat>;
    fn chats_list_all(&self) -> Vec<Chat>;
    /// `db.chats.listFiltered(filters)` — the fields are passed unwrapped to avoid
    /// dragging the `mainframe-db` `ChatListFilters` type across the crate boundary.
    fn chats_list_filtered(
        &self,
        project_id: Option<&str>,
        tags_all: Option<&[String]>,
        has_worktree: bool,
        include_archived: bool,
    ) -> Vec<Chat>;
    fn chats_reset_working_to_idle(&self) -> i64;
    /// `db.chats.addMention(chatId, mention)` — the boolean "changed" result the DB
    /// returns is unused by `addMention` (it always emits `context.updated`).
    fn chats_add_mention(&self, chat_id: &str, mention: &SessionMention);
    fn projects_get_path(&self, project_id: &str) -> Option<String>;
    fn projects_remove(&self, project_id: &str) -> Result<(), String>;
    /// `writeWorkspaceTrust(projectPath)` — persists workspace trust to the
    /// Claude CLI's `~/.claude.json` (injected so this crate does not depend on
    /// `mainframe-adapter-claude`). Backs `trust_workspace`.
    fn write_workspace_trust<'a>(
        &'a self,
        project_path: &'a str,
    ) -> BoxFuture<'a, Result<(), String>>;
    fn settings_get(&self, ns: &str, key: &str) -> Option<String>;
    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> bool;
    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> bool;
    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]);
    fn add_detected_prs(&self, chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr>;
    fn get_dismissed_worktrees(&self, _chat_id: &str) -> Vec<String> {
        Vec::new()
    }
    fn add_dismissed_worktree(&self, _chat_id: &str, _worktree_path: &str) -> bool {
        false
    }

    fn create_session(
        &self,
        adapter_id: &str,
        options: mainframe_types::adapter::SessionOptions,
    ) -> Option<Arc<dyn AdapterSession>>;

    /// `adapters.get(adapterId)?.createPlanModeHandler()` — required (not
    /// defaulted), per the #273 rule that every deps impl states its answer.
    fn create_plan_mode_handler(&self, adapter_id: &str) -> Option<Arc<dyn PlanModeActionHandler>>;

    fn attachment_delete_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    fn process_attachments<'a>(
        &'a self,
        chat_id: &'a str,
        attachment_ids: &'a [String],
    ) -> BoxFuture<'a, ProcessedAttachments>;
    fn kill_tasks_for_chat<'a>(
        &'a self,
        chat_id: &'a str,
        worktree_path: Option<String>,
        session: Option<Arc<dyn AdapterSession>>,
    ) -> BoxFuture<'a, ()>;
    fn remove_worktree<'a>(
        &'a self,
        project_path: &'a str,
        worktree_path: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, ()>;
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>>;
    fn stop_scope_tunnels<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>>;
    fn scan_loaded_history<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    fn resolve_tuning<'a>(
        &'a self,
        chat_id: &'a str,
    ) -> BoxFuture<'a, Option<mainframe_types::chat::ResolvedTuning>>;
    /// `getSessionContext(chatId, projectPath, db, adapters, session, attachmentStore,
    /// adapterId)` — the whole context-tracker read is injected because it needs the
    /// AdapterRegistry + AttachmentStore the facade does not otherwise hold.
    fn get_session_context<'a>(
        &'a self,
        chat_id: &'a str,
        project_path: &'a str,
        session: Option<Arc<dyn AdapterSession>>,
        adapter_id: Option<String>,
    ) -> BoxFuture<'a, SessionContext>;
    fn apply_codex_provider_tuning(&self, session: &Arc<dyn AdapterSession>);
    fn generate_title<'a>(
        &'a self,
        adapter_id: &'a str,
        content: &'a str,
        binary: &'a str,
    ) -> BoxFuture<'a, Option<String>>;
    fn is_working_tree_dirty<'a>(&'a self, project_path: &'a str) -> BoxFuture<'a, bool>;
    fn path_exists(&self, path: &str) -> bool;

    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool;
    fn notify_task_complete(&self) -> bool;
    fn notify_session_error(&self) -> bool;
    /// Gates `notifications.chat.attentionRequest`. Not defaulted — a
    /// defaulted trait method silently inherited the wrong behavior once
    /// before (bug class #273), so every deps impl must state its answer.
    fn notify_attention_request(&self) -> bool;
    fn send_push(&self, _msg: PushOut) {}

    /// `onProviderQuota(adapterId, quota)` — account-wide provider-plan quota pushed
    /// from a session event (Codex `account/rateLimits/updated`, Claude
    /// `rate_limit_event`). Default no-op mirrors the TS optional callback: a
    /// ChatManager built without a QuotaManager simply drops it.
    fn on_provider_quota(&self, _adapter_id: &str, _quota: ProviderQuota) {}

    /// `extractMentionsFromText(chatId, text, db)` — returns whether any mention
    /// was newly recorded (Claude-agnostic but db-backed → injected).
    fn extract_mentions_from_text(&self, chat_id: &str, text: &str) -> bool;
    fn tracker_remove_chat(&self, chat_id: &str);
    /// `tracker.listLive(chatId)` — live (running) background tasks, for enrichChat's
    /// backgroundActivity + widened working state. Required, not defaulted: an
    /// implementation that silently inherited an empty default blanked
    /// backgroundActivity for every chat (#273).
    fn tracker_list_live(&self, chat_id: &str) -> Vec<BackgroundTask>;
    /// `tracker?.endAllRunning(chatId)` — stop every live background task on session
    /// exit. Required, not defaulted: an implementation that silently inherited an
    /// empty default left orphaned tasks Running forever, pinning `displayStatus:
    /// working` and `backgroundActivity` with no recovery path (#273).
    fn tracker_end_all_running(&self, chat_id: &str);
    /// D5 (#273) — the workflow-run store's counterpart to
    /// `tracker_end_all_running`, delegated to `EventHandlerDeps` below.
    fn workflow_runs_stop_all(&self, chat_id: &str);
    /// `db.chats.clearSession(chatId)` — NULL session id/file, transcript_missing=0.
    /// Required (not a no-op default): `continue-here` relies on it persisting.
    fn chats_clear_session(&self, chat_id: &str);
    /// `db.chats.clearWorktree(chatId)` — NULL worktree_path/branch_name.
    /// Required (not a no-op default): `continue-in-project-root` relies on it persisting.
    fn chats_clear_worktree(&self, chat_id: &str);
    /// `adapters.get(adapterId)?.isTranscriptPresent(sessionId, projectPath, sessionFilePath)`.
    /// `None` = presence cannot be determined (missing predicate / null / error).
    /// Required, not defaulted: an implementation that silently inherited a `None`
    /// default left transcript-presence reconciliation permanently inert in
    /// production — same class as #273 (#289).
    fn is_transcript_present<'a>(
        &'a self,
        adapter_id: &'a str,
        session_id: &'a str,
        project_path: &'a str,
        session_file_path: Option<&'a str>,
    ) -> BoxFuture<'a, Option<bool>>;
    /// `adapters.getSnapshots().find(id)?.models ?? []` — the adapter's catalog for
    /// the lifecycle default-model normalization. Required, not defaulted: an
    /// implementation that silently inherited the empty default made
    /// `normalize_saved_default_model`'s probe-failure short-circuit fire on every
    /// chat creation, so a retired saved default leaked into new chats (#290).
    fn adapter_snapshot_models(
        &self,
        adapter_id: &str,
    ) -> Vec<mainframe_types::adapter::AdapterModel>;
}
