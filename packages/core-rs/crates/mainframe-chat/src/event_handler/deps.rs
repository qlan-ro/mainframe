use super::*;

/// A fire-and-forget push notification (`pushService.sendPush`).
#[derive(Debug, Clone, PartialEq)]
pub struct PushOut {
    pub chat_id: String,
    pub title: String,
    pub body: String,
    pub push_type: String,
    pub priority: String,
}

/// Partial `db.chats.update` patch the sink writes. `process_state` is tri-state
/// (`None` absent, `Some(None)` explicit null, `Some(Some(x))` value).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EventChatUpdate {
    pub claude_session_id: Option<String>,
    pub session_file_path: Option<String>,
    pub plan_mode: Option<bool>,
    pub total_cost: Option<f64>,
    pub total_tokens_input: Option<i64>,
    pub total_tokens_output: Option<i64>,
    pub last_context_tokens_input: Option<i64>,
    /// The CLI's own context totals (`onContextUsage`) — persisted so the meter
    /// survives reloads (#197).
    pub last_context_total_tokens: Option<u64>,
    pub last_context_max_tokens: Option<u64>,
    pub process_state: Option<Option<ProcessState>>,
    pub updated_at: Option<String>,
}

/// The injected dependency surface (mirrors the TS `EventHandler` constructor
/// callbacks + `db`). Claude-specific pieces (`stripMainframeCommandTags`, the
/// display pipeline) and the not-Send db repos are narrowed to trait methods so
/// this crate needs no adapter-claude/db dependency.
pub trait EventHandlerDeps: Send + Sync {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>>;
    fn emit_event(&self, event: DaemonEvent);
    fn get_tool_categories(&self, chat_id: &str) -> Option<ToolCategories>;
    fn on_queued_processed(&self, chat_id: &str, uuid: &str);
    fn on_queued_cleared(&self, chat_id: &str);
    fn get_queued_refs(&self, chat_id: &str) -> Vec<QueuedMessageRef>;
    /// `prepareMessagesForClient` (Claude-specific; injected to avoid a cycle).
    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage>;
    /// `stripMainframeCommandTags` (Claude-specific; injected).
    fn strip_command_tags(&self, text: &str) -> String;

    // db surface --------------------------------------------------------------
    fn chats_update(&self, chat_id: &str, patch: &EventChatUpdate);
    fn projects_get_path(&self, project_id: &str) -> Option<String>;
    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> bool;
    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> bool;
    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]);
    fn add_detected_prs(&self, chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr>;

    // notifications + push ----------------------------------------------------
    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool;
    fn notify_task_complete(&self) -> bool;
    fn notify_session_error(&self) -> bool;
    /// Gates `notifications.chat.attentionRequest`. Not defaulted — a
    /// defaulted trait method silently inherited the wrong behavior once
    /// before (bug class #273), so every deps impl must state its answer.
    fn notify_attention_request(&self) -> bool;
    fn send_push(&self, _msg: PushOut) {}

    /// `tracker?.endAllRunning(chatId)` — stop every live background task on session
    /// end (the CLI owns them; none can report completion after it dies). Required,
    /// not defaulted: a silently-inherited no-op left orphaned tasks Running forever
    /// in production, the same defaulted-trait bug class as #273.
    fn tracker_end_all_running(&self, chat_id: &str);

    /// D5 (#273) — the workflow-run store's counterpart to
    /// `tracker_end_all_running`: the CLI owns every live workflow run, so none
    /// can report completion after it dies.
    fn workflow_runs_stop_all(&self, chat_id: &str);

    /// `onProviderQuota(adapterId, quota)` — an account-wide provider-plan quota
    /// escalation pushed from a session event (Codex `account/rateLimits/updated`,
    /// Claude `rate_limit_event`). Default no-op mirrors the TS optional callback: a
    /// ChatManager built without a QuotaManager simply drops it.
    fn on_provider_quota(&self, _adapter_id: &str, _quota: ProviderQuota) {}

    /// A completed, non-error tool call that created a worktree (`EnterWorktree`
    /// or `git worktree add` — see `worktree_tool::creates_worktree`).
    /// Sync fire-and-forget; the offer registry spawns its own rescan.
    fn on_worktree_trigger(&self, _chat_id: &str) {}

    /// A completed, non-error `EnterWorktree`/`ExitWorktree` call: the CLI has
    /// just moved the transcript into the new working directory's project dir.
    fn on_transcript_moved(&self, _chat_id: &str) {}

    /// `db.chats.getPendingFork(chatId)` (todo #343) — `on_result` retires it
    /// once the fork's first turn produces a result. Defaulted to `None`: the
    /// correct answer for every chat this feature doesn't touch.
    fn get_pending_fork(&self, chat_id: &str) -> Option<PendingForkState> {
        let _ = chat_id;
        None
    }
    /// `db.chats.clearPendingFork(chatId)`. No-op default, mirroring
    /// `get_pending_fork`'s default of "this chat has none to clear".
    fn clear_pending_fork(&self, chat_id: &str) {
        let _ = chat_id;
    }
}
