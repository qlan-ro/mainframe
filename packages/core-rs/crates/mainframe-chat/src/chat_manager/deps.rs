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
    /// `prepareMessagesForClient`, kept for the REST `get_display_messages`
    /// path: that read is not on the partial path and stays a full `prepare`
    /// over the whole history every call.
    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage>;
    /// A fresh [`mainframe_display::DisplayProjector`] for one chat's live
    /// display computation, bridged to `EventHandlerDeps`'s identical method
    /// via `deps_event.rs::EhDeps`. Required, not defaulted: every deps impl
    /// states which projector it is.
    fn display_projector(&self) -> Box<dyn mainframe_display::DisplayProjector>;
    fn strip_command_tags(&self, text: &str) -> String;

    fn chats_get(&self, id: &str) -> Option<Chat>;
    fn chats_create(&self, new_chat: &NewChat) -> Chat;
    /// Hard-delete a chat row (discard step 4). `chat_tags` cascade via the
    /// schema's `ON DELETE CASCADE`.
    fn chats_delete(&self, chat_id: &str);
    /// `remove_dir_all(scratch_path)` (discard step 3). `NotFound` counts as
    /// success; any other error is surfaced so the row is not deleted and a
    /// retry stays possible.
    fn remove_scratch_dir<'a>(&'a self, scratch_path: &'a str)
    -> BoxFuture<'a, Result<(), String>>;
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
        include_temporary: bool,
    ) -> Vec<Chat>;
    fn chats_reset_working_to_idle(&self) -> i64;
    /// `db.chats.addMention(chatId, mention)` — the boolean "changed" result the DB
    /// returns is unused by `addMention` (it always emits `context.updated`).
    fn chats_add_mention(&self, chat_id: &str, mention: &SessionMention);
    fn projects_get_path(&self, project_id: &str) -> Option<String>;
    /// The owning adapter's initial transcript path for a new session, or
    /// `None` when that adapter has no predictable layout (Codex).
    fn initial_transcript_path(
        &self,
        adapter_id: &str,
        session_id: &str,
        cwd: &str,
    ) -> Option<String>;
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
    /// defaulted), so every deps impl states its answer.
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
    /// Gates `notifications.chat.attentionRequest`. Not defaulted — a defaulted
    /// trait method silently inherited the wrong behavior once before, so every
    /// deps impl must state its answer.
    fn notify_attention_request(&self) -> bool;
    fn send_push(&self, _msg: PushOut) {}

    /// `onProviderQuota(adapterId, quota)` — account-wide provider-plan quota pushed
    /// from a session event (Codex `account/rateLimits/updated`, Claude
    /// `rate_limit_event`). Default no-op: a ChatManager built without a
    /// QuotaManager simply drops it.
    fn on_provider_quota(&self, _adapter_id: &str, _quota: ProviderQuota) {}

    /// `extractMentionsFromText(chatId, text, db)` — returns whether any mention
    /// was newly recorded (Claude-agnostic but db-backed → injected).
    fn extract_mentions_from_text(&self, chat_id: &str, text: &str) -> bool;
    fn tracker_remove_chat(&self, chat_id: &str);
    /// `tracker.listLive(chatId)` — live (running) background tasks, for enrichChat's
    /// backgroundActivity + widened working state. Required, not defaulted: an
    /// implementation that silently inherited an empty default blanked
    /// backgroundActivity for every chat.
    fn tracker_list_live(&self, chat_id: &str) -> Vec<BackgroundTask>;
    /// `tracker?.endAllRunning(chatId)` — stop every live background task on session
    /// exit. Required, not defaulted: an implementation that silently inherited an
    /// empty default left orphaned tasks Running forever, pinning
    /// `displayStatus: working` and `backgroundActivity` with no recovery path.
    fn tracker_end_all_running(&self, chat_id: &str);
    /// The workflow-run store's counterpart to `tracker_end_all_running`,
    /// delegated to `EventHandlerDeps` below.
    fn workflow_runs_stop_all(&self, chat_id: &str);
    /// `db.chats.clearSession(chatId)` — NULL session id/file, transcript_missing=0.
    /// Required (not a no-op default): `continue-here` relies on it persisting.
    fn chats_clear_session(&self, chat_id: &str);
    /// `db.chats.clearWorktree(chatId)` — NULL worktree_path/branch_name.
    /// Required (not a no-op default): `continue-in-project-root` relies on it persisting.
    fn chats_clear_worktree(&self, chat_id: &str);
    /// `adapters.get(adapterId)?.locateTranscript(sessionId, projectPath, sessionFilePath)`.
    /// `None` = the location cannot be determined (no adapter / no layout /
    /// error). Required, not defaulted: an implementation that silently
    /// inherited a `None` default left transcript-presence reconciliation
    /// permanently inert in production.
    fn locate_transcript<'a>(
        &'a self,
        adapter_id: &'a str,
        session_id: &'a str,
        project_path: &'a str,
        session_file_path: Option<&'a str>,
    ) -> BoxFuture<'a, Option<mainframe_types::transcript::TranscriptLocation>>;
    /// The per-spawn no-persistence capability read:
    /// `adapters.get(adapterId)?.capabilities.noPersistence`. Never derived
    /// from the adapter id itself — an unregistered adapter answers `false`,
    /// same as one that never opted in.
    fn adapter_supports_no_persistence(&self, adapter_id: &str) -> bool;
    /// `fs.mkdir(path, { recursive: true })` for a non-project chat's scratch
    /// cwd. Run before every spawn: the first call creates it, and a later one
    /// recreates a deleted directory at the same path.
    fn ensure_dir<'a>(&'a self, path: &'a str) -> BoxFuture<'a, ()>;
    /// `db.chats.markContextLost(chatId, contextLostAt)`: the one DB path that
    /// atomically stamps the loss time and clears `claude_session_id` /
    /// `session_file_path` / `vendor_session_ephemeral` — `chats_update`'s
    /// generic patch cannot write an explicit NULL for the first two columns.
    fn mark_context_lost(&self, chat_id: &str, context_lost_at: &str);
    // ── fork-a-chat ───────────────────────────────────────────────────────────
    /// The parent's adapter display name + fork capability, for `fork_chat`'s
    /// capability check and its 422 message. Defaulted to "cannot fork" so
    /// every pre-existing `ChatManagerDeps` implementer (test doubles included)
    /// keeps compiling without opting in — unlike the required methods above,
    /// "not fork-capable" is the correct default for every adapter that
    /// predates this feature.
    fn adapter_fork_info(&self, adapter_id: &str) -> AdapterForkInfo {
        AdapterForkInfo {
            name: adapter_id.to_string(),
            fork: false,
            unavailable_reason: None,
        }
    }
    /// Pin a fork's starting point through the parent's adapter
    /// (`Adapter::pin_fork_point`). Defaulted to `Unsupported`, matching the
    /// `Adapter` trait's own default for adapters with no fork mechanism.
    fn pin_fork_point<'a>(
        &'a self,
        adapter_id: &'a str,
        request: ForkPinRequest,
    ) -> BoxFuture<'a, Result<ForkSource, ForkPinError>> {
        let _ = (adapter_id, request);
        Box::pin(async { Err(ForkPinError::Unsupported) })
    }
    /// `db.chats.createFork` — a single INSERT that seeds the new chat from the
    /// parent's resolved config. Defaulted to a failure so a deps impl that never
    /// wires storage cannot silently mint unpersisted forks.
    fn create_fork(&self, insert: &ForkCreateInput) -> Result<Chat, String> {
        let _ = insert;
        Err("fork creation is not supported by this ChatManagerDeps".to_string())
    }
    /// `db.chats.getPendingFork(chatId)`. `None` (the default) is the correct
    /// answer for every chat this feature doesn't touch — a chat with no
    /// pending fork, or a deps impl that predates the feature entirely.
    fn get_pending_fork(&self, chat_id: &str) -> Option<PendingForkState> {
        let _ = chat_id;
        None
    }
    /// `db.chats.clearPendingFork(chatId)`. No-op default, mirroring
    /// `get_pending_fork`'s default of "this chat has none to clear".
    fn clear_pending_fork(&self, chat_id: &str) {
        let _ = chat_id;
    }
    /// The root directory fork snapshots are pinned under
    /// (`<data_dir>/fork-snapshots`); `fork_chat` joins a fresh nanoid onto it.
    /// Defaulted to a process-temp path so a deps impl that never overrides it
    /// (every test double outside this feature) never has a real answer to give —
    /// `fork_chat` only reaches this once `adapter_fork_info` has already said yes.
    fn fork_snapshots_dir(&self) -> String {
        std::env::temp_dir()
            .join("mainframe-fork-snapshots")
            .to_string_lossy()
            .into_owned()
    }

    /// The directory the history snapshot cache (`load_history_into_cache`'s
    /// cold-load shortcut) keeps `<chat_id>.json` snapshots under
    /// (`<data_dir>/cache/history`). Defaulted the same way
    /// `fork_snapshots_dir` is: every deps impl outside the daemon (every
    /// test double) gets a harmless process-temp path it never has reason to
    /// read back — the cache only touches disk once `AdapterSession::
    /// history_sources` reports a non-empty list, which the trait's own
    /// default (and every pre-existing test fake) never does.
    fn history_cache_dir(&self) -> String {
        std::env::temp_dir()
            .join("mainframe-history-cache")
            .to_string_lossy()
            .into_owned()
    }

    // ── side chats ────────────────────────────────────────────────────────────
    /// `db.chats.findOrCreateSideChat(parent)` — a SELECT-then-INSERT that
    /// returns the parent's existing side chat (`created = false`) or seeds and
    /// inserts a new one from the parent's resolved config (`created = true`).
    /// Required (not defaulted): the two implementers (`DaemonChatDeps`,
    /// `StoreDeps`) both back a real store, so a silent no-op default would mint
    /// side chats that vanish on the next read.
    fn chats_find_or_create_side_chat(&self, parent: &Chat) -> Result<(Chat, bool), String>;

    // ── provider segments ─────────────────────────────────────────────────────
    /// The segment repository. `None` (the default) runs every chat as one
    /// segment on one provider session — the behavior before segments existed,
    /// and the correct answer for every test double that stores no segments.
    fn segment_store(&self) -> Option<&dyn crate::segments::SegmentStore> {
        None
    }
    /// The adapter's cached catalog snapshot (name, installed, models,
    /// capabilities). `None` (the default) means "not installed", which makes
    /// a provider switch refuse rather than guess.
    fn adapter_info(&self, adapter_id: &str) -> Option<mainframe_types::adapter::AdapterInfo> {
        let _ = adapter_id;
        None
    }
    /// Whether the orchestration MCP server's `chat_read` tool reaches this
    /// chat's sessions; the handoff header then points at it for omitted
    /// items. `false` until that server exists.
    fn orchestration_mcp_attached(&self, chat_id: &str) -> bool {
        let _ = chat_id;
        false
    }
}
