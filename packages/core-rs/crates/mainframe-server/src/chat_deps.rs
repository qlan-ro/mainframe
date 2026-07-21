//! The production `ChatManagerDeps` implementation — the daemon-side wiring that
//! injects every real collaborator into the ported `ChatManager` (Task 4.6c).
//!
//! In the TS `ChatManager` the constructor closes over `db`, `adapters`,
//! `tracker`, `attachmentStore` and the sub-managers wire themselves with
//! closures over `this`. The Rust port lifted that whole injected surface into the
//! single `ChatManagerDeps` trait (see `mainframe_chat::chat_manager`); this module
//! is the one production impl of it.
//!
//! Two structural facts shape the code:
//!   1. `ChatManagerDeps`'s DB accessors are **synchronous** but the daemon owns
//!      the connection behind the async `Db` actor. They go through the SYNC-DB
//!      BRIDGE (`Db::call_blocking`) — one WAL connection, no second writer.
//!   2. A handful of generic ported helpers (`resolve_tuning_for_chat`,
//!      `extract_mentions_from_text`, `read_notification_config`) take a trait the
//!      raw `!Send` `DatabaseManager` cannot satisfy across the actor boundary;
//!      small local bridge types (`RtDeps`, `CtxDbHandle`) satisfy those bounds by
//!      routing each call back through `Db::call_blocking`.

use std::collections::HashSet;
use std::sync::Arc;

use mainframe_adapter_api::{AdapterError, AdapterRegistry, AdapterSession, BoxFuture};
use mainframe_adapter_claude::external_session_cache::{
    ExternalSessionCache, new_external_session_cache,
};
use mainframe_adapter_claude::external_sessions::ExternalSessionListOpts;
use mainframe_adapter_claude::messages::display_pipeline::prepare_messages_for_client;
use mainframe_adapter_claude::messages::message_parsing::strip_mainframe_command_tags;
use mainframe_adapter_claude::pr_detection::{extract_pr_from_tool_result, is_pr_create_command};
use mainframe_background_tasks::kill::{
    KillTasksForChatArgs, SessionLike, StopResult, kill_tasks_for_chat,
};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_chat::chat_manager::{
    ChatManager, ChatManagerDeps, ChatUpdate, ProcessedAttachments,
};
use mainframe_chat::context_tracker::{
    AttachmentLister, ContextDb, extract_mentions_from_text, get_session_context,
};
use mainframe_chat::attachment_processor;
use mainframe_chat::event_handler::PushOut;
use mainframe_chat::external_session_service::{
    ExternalChatUpdate, ExternalSessionDeps, ExternalSessionService,
};
use mainframe_chat::resolve_tuning_for_chat::{ResolveTuningDeps, resolve_tuning_for_chat};
use mainframe_runtime::ResolvedPath;
use mainframe_runtime::time::now_iso8601;
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::attachment::attachment_store::AttachmentKind;
use mainframe_services::notifications::notification_config::{
    read_notification_config, should_notify_permission,
};
use mainframe_services::push::PushService;
use mainframe_services::push::push_service::{PushMessage, PushPriority};
use mainframe_services::quota::{IngestMode, QuotaManager};
use mainframe_services::settings::provider_config::SettingsReader;
use mainframe_types::adapter::{
    AdapterModel, DetectedPr, DetectedPrSource, ExternalSessionPage, ProviderQuota, SessionOptions,
};
use mainframe_types::chat::{
    Chat, ChatMessage, ChatMessageType, ChatStatus, MessageContent, MessageContentNode, Project,
    ResolvedTuning, TodoItem,
};
use mainframe_types::content::LeafContent;
use mainframe_types::context::{
    SessionAttachment, SessionAttachmentKind, SessionMention, SkillFileEntry,
};
use mainframe_types::display::{DisplayMessage, ToolCategories};
use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use crate::chat_seams::LaunchStopper;
use crate::ctx::GitFactory;
use crate::db::Db;

/// Translate the `ChatManager`'s superset `ChatUpdate` into the DB repository's
/// `ChatUpdate`. Field names and tri-state semantics line up 1:1; the DB-only
/// columns the chat layer never patches (mentions, created_at, pinned, tuning)
/// stay `None`.
fn to_db_update(patch: &ChatUpdate) -> mainframe_db::chats::ChatUpdate {
    mainframe_db::chats::ChatUpdate {
        adapter_id: patch.adapter_id.clone(),
        model: patch.model.clone(),
        claude_session_id: patch.claude_session_id.clone(),
        session_file_path: patch.session_file_path.clone(),
        status: patch.status,
        total_cost: patch.total_cost,
        total_tokens_input: patch.total_tokens_input,
        total_tokens_output: patch.total_tokens_output,
        last_context_tokens_input: patch.last_context_tokens_input,
        title: patch.title.clone(),
        permission_mode: patch.permission_mode,
        worktree_path: patch.worktree_path.clone(),
        branch_name: patch.branch_name.clone(),
        process_state: patch.process_state,
        updated_at: patch.updated_at.clone(),
        plan_mode: patch.plan_mode,
        ..Default::default()
    }
}

/// Translate the external-session-import `Partial<Chat>` patch into the DB
/// repository's `ChatUpdate`. `Object.assign(chat, updates)` in the TS only ever
/// touches these four fields.
fn to_external_chat_update(patch: &ExternalChatUpdate) -> mainframe_db::chats::ChatUpdate {
    mainframe_db::chats::ChatUpdate {
        claude_session_id: patch.claude_session_id.clone(),
        title: patch.title.clone(),
        created_at: patch.created_at.clone(),
        updated_at: patch.updated_at.clone(),
        ..Default::default()
    }
}

/// The daemon-side `ChatManagerDeps`. Cheap to clone-share (every field is an
/// `Arc`/handle), constructed once at boot in [`build_chat_manager`].
pub struct DaemonChatDeps {
    db: Db,
    adapters: Arc<AdapterRegistry>,
    background_tasks: Arc<BackgroundTaskTracker>,
    attachments: Arc<AttachmentStore>,
    push: Arc<PushService>,
    git: GitFactory,
    broadcast: broadcast::Sender<DaemonEvent>,
    launch: Arc<dyn LaunchStopper>,
    quota: Arc<QuotaManager>,
    /// Process-lifetime Claude external-session enrichment cache — owned here
    /// (not a module-level singleton, forbidden by PORTING.md §5) and threaded
    /// into every `list_external_sessions("claude", ...)` call.
    claude_external_session_cache: ExternalSessionCache,
}

impl DaemonChatDeps {
    /// `scan_loaded_history` only receives the chatId (§ trait contract), so it
    /// re-derives a session from the same chat row `doLoadChat` already read
    /// rather than reusing the live one — both are stateless reads over the
    /// on-disk transcript, so results match; the cost is a second file read
    /// (Claude) or a second temp app-server spawn (Codex).
    fn session_for_scan(&self, chat_id: &str) -> Option<Arc<dyn AdapterSession>> {
        let chat = self.chats_get(chat_id)?;
        let claude_session_id = chat.claude_session_id.clone()?;
        let project_path = self.projects_get_path(&chat.project_id)?;
        let effective_path = chat.worktree_path.clone().unwrap_or(project_path);
        self.create_session(
            &chat.adapter_id,
            SessionOptions {
                project_path: effective_path,
                chat_id: Some(claude_session_id),
                mainframe_chat_id: chat_id.to_string(),
            },
        )
    }

    /// `@`-mention extraction + PR-URL scan over already-loaded history, then
    /// persist newly-detected PRs and emit `chat.prDetected` for each.
    fn scan_and_persist_prs(&self, chat_id: &str, history: &[ChatMessage]) {
        let ctx_db = CtxDbHandle {
            db: self.db.clone(),
        };
        scan_history_for_mentions(chat_id, history, &ctx_db);
        let scanned = scan_history_for_prs(history);
        if scanned.is_empty() {
            return;
        }
        let persisted = self.add_detected_prs(chat_id, &scanned);
        for pr in persisted {
            self.emit_event(DaemonEvent::ChatPrDetected {
                chat_id: chat_id.to_string(),
                pr,
            });
        }
    }

    /// `Promise.all([extractPlanFiles(), extractSkillFiles()])` — either failing
    /// drops both (best-effort, matches the TS try/catch).
    async fn persist_plan_and_skill_files(&self, chat_id: &str, session: &dyn AdapterSession) {
        let Ok((plan_paths, skill_paths)) =
            tokio::try_join!(session.extract_plan_files(), session.extract_skill_files())
        else {
            return;
        };
        for p in plan_paths {
            self.add_plan_file(chat_id, &p);
        }
        for entry in skill_paths {
            self.add_skill_file(chat_id, &entry);
        }
    }
}

impl ChatManagerDeps for DaemonChatDeps {
    fn emit_event(&self, event: DaemonEvent) {
        // send() errors only when there are no WS subscribers — not fatal.
        let _ = self.broadcast.send(event);
    }

    fn get_tool_categories(&self, chat_id: &str) -> Option<ToolCategories> {
        let id = chat_id.to_string();
        let chat = self
            .db
            .call_blocking(move |d| d.chats.get(&id))
            .ok()
            .flatten()?;
        self.adapters
            .get(&chat.adapter_id)
            .and_then(|a| a.get_tool_categories())
    }

    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        prepare_messages_for_client(raw, categories)
    }

    fn strip_command_tags(&self, text: &str) -> String {
        strip_mainframe_command_tags(text)
    }

    fn chats_get(&self, id: &str) -> Option<Chat> {
        let id = id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get(&id))
            .ok()
            .flatten()
    }

    fn chats_create(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
        automation_run_id: Option<&str>,
    ) -> Chat {
        let (pid, aid) = (project_id.to_string(), adapter_id.to_string());
        let model = model.map(str::to_string);
        let mode = permission_mode.map(str::to_string);
        let run_id = automation_run_id.map(str::to_string);
        let created = self.db.call_blocking(move |d| {
            d.chats.create(
                &pid,
                &aid,
                model.as_deref(),
                mode.as_deref(),
                run_id.as_deref(),
            )
        });
        match created {
            Ok(chat) => chat,
            // The trait signature is infallible (mirrors the synchronous
            // better-sqlite3 `db.chats.create`); a DB failure has no error channel
            // to surface through, so log loudly and return an unpersisted stub so
            // the caller does not crash. TODO(port): revisit if the ported
            // orchestration ever grows a fallible create path.
            Err(err) => {
                tracing::error!(%err, project_id, adapter_id, "chats.create failed");
                fallback_chat(project_id, adapter_id, permission_mode)
            }
        }
    }

    fn chats_update(&self, chat_id: &str, patch: &ChatUpdate) {
        let id = chat_id.to_string();
        let db_patch = to_db_update(patch);
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.chats.update(&id, &db_patch))
        {
            tracing::warn!(%err, chat_id, "chats.update failed");
        }
    }

    fn chats_clear_session(&self, chat_id: &str) {
        let id = chat_id.to_string();
        if let Err(err) = self.db.call_blocking(move |d| d.chats.clear_session(&id)) {
            tracing::warn!(%err, chat_id, "chats.clearSession failed");
        }
    }

    fn chats_clear_worktree(&self, chat_id: &str) {
        let id = chat_id.to_string();
        if let Err(err) = self.db.call_blocking(move |d| d.chats.clear_worktree(&id)) {
            tracing::warn!(%err, chat_id, "chats.clearWorktree failed");
        }
    }

    fn chats_list(&self, project_id: &str) -> Vec<Chat> {
        let pid = project_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.list(&pid))
            .unwrap_or_default()
    }

    fn chats_list_all(&self) -> Vec<Chat> {
        self.db
            .call_blocking(|d| d.chats.list_all())
            .unwrap_or_default()
    }

    fn chats_list_filtered(
        &self,
        project_id: Option<&str>,
        tags_all: Option<&[String]>,
        has_worktree: bool,
        include_archived: bool,
    ) -> Vec<Chat> {
        let filters = mainframe_db::chats::ChatListFilters {
            project_id: project_id.map(str::to_string),
            tags_all: tags_all.map(<[String]>::to_vec),
            has_worktree,
            include_archived,
        };
        self.db
            .call_blocking(move |d| d.chats.list_filtered(&filters))
            .unwrap_or_default()
    }

    fn chats_add_mention(&self, chat_id: &str, mention: &SessionMention) {
        let (id, mention) = (chat_id.to_string(), mention.clone());
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.chats.add_mention(&id, &mention))
        {
            tracing::warn!(%err, chat_id, "chats.add_mention failed");
        }
    }

    fn chats_reset_working_to_idle(&self) -> i64 {
        self.db
            .call_blocking(|d| d.chats.reset_working_to_idle())
            .unwrap_or(0)
    }

    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        let pid = project_id.to_string();
        self.db
            .call_blocking(move |d| d.projects.get(&pid))
            .ok()
            .flatten()
            .map(|p| p.path)
    }

    fn projects_remove(&self, project_id: &str) {
        let pid = project_id.to_string();
        if let Err(err) = self.db.call_blocking(move |d| d.projects.remove(&pid)) {
            tracing::warn!(%err, project_id, "projects.remove failed");
        }
    }

    fn settings_get(&self, ns: &str, key: &str) -> Option<String> {
        let (ns, key) = (ns.to_string(), key.to_string());
        self.db
            .call_blocking(move |d| Ok(d.settings.get(&ns, &key).ok().flatten()))
            .ok()
            .flatten()
    }

    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> bool {
        let (id, fp) = (chat_id.to_string(), file_path.to_string());
        self.db
            .call_blocking(move |d| d.chats.add_plan_file(&id, &fp))
            .unwrap_or(false)
    }

    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> bool {
        let (id, entry) = (chat_id.to_string(), entry.clone());
        self.db
            .call_blocking(move |d| d.chats.add_skill_file(&id, &entry))
            .unwrap_or(false)
    }

    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]) {
        let (id, todos) = (chat_id.to_string(), todos.to_vec());
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.chats.update_todos(&id, &todos))
        {
            tracing::warn!(%err, chat_id, "chats.update_todos failed");
        }
    }

    fn add_detected_prs(&self, chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr> {
        let (id, prs) = (chat_id.to_string(), prs.to_vec());
        self.db
            .call_blocking(move |d| d.chats.add_detected_prs(&id, &prs))
            .unwrap_or_default()
    }

    fn create_session(
        &self,
        adapter_id: &str,
        options: SessionOptions,
    ) -> Option<Arc<dyn AdapterSession>> {
        self.adapters
            .get(adapter_id)
            .map(|adapter| adapter.create_session(options))
    }

    fn attachment_delete_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.attachments.delete_chat(chat_id).await;
        })
    }

    fn process_attachments<'a>(
        &'a self,
        chat_id: &'a str,
        attachment_ids: &'a [String],
    ) -> BoxFuture<'a, ProcessedAttachments> {
        Box::pin(async move {
            let mut fetched = Vec::with_capacity(attachment_ids.len());
            for id in attachment_ids {
                match self.attachments.get(chat_id, id).await {
                    Some(attachment) => fetched.push(attachment),
                    None => tracing::warn!(
                        chat_id,
                        attachment_id = %id,
                        "processAttachments: attachment not found in store; skipping"
                    ),
                }
            }
            attachment_processor::process_attachments(&fetched)
        })
    }

    fn kill_tasks_for_chat<'a>(
        &'a self,
        chat_id: &'a str,
        worktree_path: Option<String>,
        session: Option<Arc<dyn AdapterSession>>,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let wrapped = session.map(SessionKillAdapter);
            let session_ref = wrapped.as_ref().map(|w| w as &dyn SessionLike);
            kill_tasks_for_chat(KillTasksForChatArgs {
                chat_id,
                worktree_path: worktree_path.as_deref(),
                session: session_ref,
                tracker: &self.background_tasks,
                spool_root: None,
            })
            .await;
        })
    }

    fn remove_worktree<'a>(
        &'a self,
        project_path: &'a str,
        worktree_path: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            mainframe_services::workspace::remove_worktree(
                project_path,
                worktree_path,
                branch_name,
            )
            .await;
        })
    }

    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        self.launch
            .stop_launch_processes(project_id, effective_path)
    }

    fn scan_loaded_history<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let Some(session) = self.session_for_scan(chat_id) else {
                return;
            };
            let Ok(history) = session.load_history().await else {
                return;
            };
            if !history.is_empty() {
                self.scan_and_persist_prs(chat_id, &history);
            }
            self.persist_plan_and_skill_files(chat_id, session.as_ref())
                .await;
        })
    }

    fn resolve_tuning<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Option<ResolvedTuning>> {
        let db = self.db.clone();
        let adapters = Arc::clone(&self.adapters);
        Box::pin(async move {
            let deps = RtDeps { db, adapters };
            resolve_tuning_for_chat(&deps, chat_id).await
        })
    }

    fn get_session_context<'a>(
        &'a self,
        chat_id: &'a str,
        project_path: &'a str,
        session: Option<Arc<dyn AdapterSession>>,
        adapter_id: Option<String>,
    ) -> BoxFuture<'a, mainframe_types::context::SessionContext> {
        Box::pin(async move {
            let ctx_db = CtxDbHandle {
                db: self.db.clone(),
            };
            let lister = AttachmentListerHandle {
                store: Arc::clone(&self.attachments),
            };
            get_session_context(
                chat_id,
                project_path,
                &ctx_db,
                &self.adapters,
                session.as_ref(),
                Some(&lister),
                adapter_id.as_deref(),
            )
            .await
        })
    }

    fn apply_codex_provider_tuning(&self, _session: &Arc<dyn AdapterSession>) {
        // TODO(port): `setCodexProviderTuning(personality, reasoningSummary)` is a
        // codex-only session method not present on the generic AdapterSession trait
        // (it lands with the concrete codex adapter's provider tuning, Phase 5).
        // No-op is faithful for every non-codex adapter (the TS guards on
        // `adapterId === 'codex' && 'setCodexProviderTuning' in session`).
    }

    fn generate_title<'a>(
        &'a self,
        adapter_id: &'a str,
        content: &'a str,
        binary: &'a str,
    ) -> BoxFuture<'a, Option<String>> {
        // Adapter-aware (#430): route to the owning adapter's `generateTitle`;
        // adapters without a cheap one-shot title model return `None` and the
        // caller keeps the deterministic truncated title.
        let adapter = self.adapters.get(adapter_id);
        let content = content.to_string();
        let binary = binary.to_string();
        Box::pin(async move {
            let adapter = adapter?;
            match adapter.generate_title(content, binary).await {
                Ok(title) => title,
                Err(err) => {
                    tracing::warn!(%err, "title generation failed");
                    None
                }
            }
        })
    }

    fn is_working_tree_dirty<'a>(&'a self, project_path: &'a str) -> BoxFuture<'a, bool> {
        Box::pin(async move {
            match self.git.for_project(project_path).status_raw().await {
                Ok(stdout) => !stdout.trim().is_empty(),
                Err(err) => {
                    tracing::warn!(%err, project_path, "git status --porcelain failed");
                    false
                }
            }
        })
    }

    fn path_exists(&self, path: &str) -> bool {
        std::path::Path::new(path).exists()
    }

    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool {
        let tool_name = tool_name.map(str::to_string);
        self.db
            .call_blocking(move |d| {
                let cfg = read_notification_config(d);
                Ok(should_notify_permission(&cfg, tool_name.as_deref()))
            })
            .unwrap_or(true)
    }

    fn notify_task_complete(&self) -> bool {
        self.db
            .call_blocking(|d| Ok(read_notification_config(d).chat.task_complete))
            .unwrap_or(true)
    }

    fn notify_session_error(&self) -> bool {
        self.db
            .call_blocking(|d| Ok(read_notification_config(d).chat.session_error))
            .unwrap_or(true)
    }

    fn send_push(&self, msg: PushOut) {
        let push = Arc::clone(&self.push);
        let message = PushMessage {
            title: msg.title,
            body: msg.body,
            data: serde_json::json!({ "chatId": msg.chat_id, "type": msg.push_type }),
            priority: if msg.priority == "high" {
                PushPriority::High
            } else {
                PushPriority::Default
            },
        };
        // Fire-and-forget, matching the TS `pushService?.sendPush(...).catch(...)`.
        tokio::spawn(async move {
            push.send_push(message).await;
        });
    }

    fn on_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
        // Session-pushed quota sparse-merges (Push): a partial blob keeps prior
        // windows. `ingest` persists + fans out `provider.quota.updated` itself.
        self.quota.ingest(adapter_id, quota, IngestMode::Push);
    }

    fn extract_mentions_from_text(&self, chat_id: &str, text: &str) -> bool {
        let ctx = CtxDbHandle {
            db: self.db.clone(),
        };
        extract_mentions_from_text(chat_id, Some(text), &ctx)
    }

    fn tracker_remove_chat(&self, chat_id: &str) {
        self.background_tasks.remove_chat(chat_id);
    }
}

/// The daemon-side `ExternalSessionDeps` (`getExternalSessionService()`'s
/// backing instance). `listExternalSessions` is not on the ported `Adapter`
/// trait (adapter-api TODO), so this dispatches to the concrete Claude/Codex
/// scan functions directly by adapter id rather than through the registry.
impl ExternalSessionDeps for DaemonChatDeps {
    fn projects_get(&self, project_id: &str) -> Option<Project> {
        let pid = project_id.to_string();
        self.db
            .call_blocking(move |d| d.projects.get(&pid))
            .ok()
            .flatten()
    }

    fn get_imported_session_ids(&self, project_id: &str) -> Vec<String> {
        let pid = project_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get_imported_session_ids(&pid))
            .unwrap_or_default()
    }

    fn find_by_external_session_id(&self, session_id: &str, project_id: &str) -> Option<Chat> {
        let (sid, pid) = (session_id.to_string(), project_id.to_string());
        self.db
            .call_blocking(move |d| d.chats.find_by_external_session_id(&sid, &pid))
            .ok()
            .flatten()
    }

    fn chats_create(&self, project_id: &str, adapter_id: &str) -> Chat {
        <Self as ChatManagerDeps>::chats_create(self, project_id, adapter_id, None, None, None)
    }

    fn chats_update(&self, chat_id: &str, updates: &ExternalChatUpdate) {
        let id = chat_id.to_string();
        let db_patch = to_external_chat_update(updates);
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.chats.update(&id, &db_patch))
        {
            tracing::warn!(%err, chat_id, "external-session chats.update failed");
        }
    }

    fn chats_list(&self, project_id: &str) -> Vec<Chat> {
        <Self as ChatManagerDeps>::chats_list(self, project_id)
    }

    fn settings_get(&self, ns: &str, key: &str) -> Option<String> {
        <Self as ChatManagerDeps>::settings_get(self, ns, key)
    }

    fn emit_event(&self, event: DaemonEvent) {
        <Self as ChatManagerDeps>::emit_event(self, event)
    }

    fn generate_title<'a>(
        &'a self,
        adapter_id: &'a str,
        content: &'a str,
        binary: &'a str,
    ) -> BoxFuture<'a, Option<String>> {
        <Self as ChatManagerDeps>::generate_title(self, adapter_id, content, binary)
    }

    /// `adapters.getAll().filter(a => a.listExternalSessions)` — the claude/codex
    /// scan functions are free functions (not on the polymorphic `Adapter`
    /// trait), so registration is keyed by id rather than a capability check.
    fn external_session_adapter_ids(&self) -> Vec<String> {
        self.adapters
            .get_all()
            .into_iter()
            .map(|a| a.id().to_string())
            .filter(|id| id == "claude" || id == "codex")
            .collect()
    }

    fn list_external_sessions<'a>(
        &'a self,
        adapter_id: &'a str,
        project_path: &'a str,
        exclude_ids: &'a [String],
        offset: i64,
        limit: i64,
    ) -> BoxFuture<'a, Result<ExternalSessionPage, AdapterError>> {
        let adapter_id = adapter_id.to_string();
        let project_path = project_path.to_string();
        let exclude_ids = exclude_ids.to_vec();
        Box::pin(async move {
            let page = match adapter_id.as_str() {
                "claude" => {
                    mainframe_adapter_claude::external_sessions::list_external_sessions(
                        &project_path,
                        &exclude_ids,
                        Some(ExternalSessionListOpts {
                            offset: Some(offset),
                            limit: Some(limit),
                        }),
                        &self.claude_external_session_cache,
                    )
                    .await
                }
                "codex" => {
                    mainframe_adapter_codex::list_external_sessions(
                        &project_path,
                        &exclude_ids,
                        Some(offset.max(0) as usize),
                        Some(limit.max(0) as usize),
                        None,
                    )
                    .await
                }
                other => {
                    tracing::warn!(
                        adapter_id = other,
                        "list_external_sessions: unknown adapter id"
                    );
                    ExternalSessionPage {
                        sessions: Vec::new(),
                        total: 0,
                        next_offset: None,
                    }
                }
            };
            Ok(page)
        })
    }
}

/// Assemble the production `ChatManager` from the daemon's live collaborators.
/// Called once at boot (after the AdapterRegistry + BackgroundTaskTracker exist,
/// before the server starts) — mirrors `new ChatManager(db, adapters, tracker,
/// attachmentStore, onEvent)` in `index.ts`.
#[allow(clippy::too_many_arguments)]
pub fn build_chat_manager(
    db: Db,
    adapters: Arc<AdapterRegistry>,
    background_tasks: Arc<BackgroundTaskTracker>,
    attachments: Arc<AttachmentStore>,
    push: Arc<PushService>,
    git: GitFactory,
    broadcast: broadcast::Sender<DaemonEvent>,
    launch: Arc<dyn LaunchStopper>,
    quota: Arc<QuotaManager>,
    // Title generation is now adapter-aware (#430) — the resolved PATH lives with
    // the adapter's title spawn, so the ChatManager no longer needs it. The param
    // is retained for the boot call site (mainframe-daemon) until it drops the arg.
    _resolved_path: ResolvedPath,
) -> Arc<ChatManager> {
    let deps = Arc::new(DaemonChatDeps {
        db,
        adapters,
        background_tasks,
        attachments,
        push,
        git,
        broadcast,
        launch,
        quota,
        claude_external_session_cache: new_external_session_cache(),
    });
    let external_sessions = Arc::new(ExternalSessionService::new(deps.clone()));
    Arc::new(ChatManager::new(deps).with_external_sessions(external_sessions))
}

/// Bridge `Arc<dyn AdapterSession>` → the `SessionLike` the kill sweep wants.
/// `StopBackgroundTaskResult` and `StopResult` carry the same `{ ok, error }`
/// shape; a kill/adapter error folds into `ok: false`.
struct SessionKillAdapter(Arc<dyn AdapterSession>);

impl SessionLike for SessionKillAdapter {
    fn stop_background_task<'a>(&'a self, task_id: &'a str) -> BoxFuture<'a, StopResult> {
        let session = Arc::clone(&self.0);
        let task_id = task_id.to_string();
        Box::pin(async move {
            match session.stop_background_task(task_id).await {
                Ok(r) => StopResult {
                    ok: r.ok,
                    error: r.error,
                },
                Err(err) => StopResult {
                    ok: false,
                    error: Some(err.to_string()),
                },
            }
        })
    }
}

/// A `Send + Sync` `ResolveTuningDeps` that routes the synchronous `db.chats.get`
/// / `db.settings.get` reads through the actor bridge and the async `listModels`
/// through the registry. The raw `!Send` `DatabaseManager` cannot cross the actor
/// boundary, so this handle-backed bridge stands in for it.
struct RtDeps {
    db: Db,
    adapters: Arc<AdapterRegistry>,
}

impl SettingsReader for RtDeps {
    fn get(&self, ns: &str, key: &str) -> Option<String> {
        let (ns, key) = (ns.to_string(), key.to_string());
        self.db
            .call_blocking(move |d| Ok(d.settings.get(&ns, &key).ok().flatten()))
            .ok()
            .flatten()
    }
}

impl ResolveTuningDeps for RtDeps {
    fn get_chat(&self, id: &str) -> Option<Chat> {
        let id = id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get(&id))
            .ok()
            .flatten()
    }

    fn list_models<'a>(&'a self, adapter_id: &'a str) -> BoxFuture<'a, Vec<AdapterModel>> {
        Box::pin(async move {
            match self.adapters.get(adapter_id) {
                Some(adapter) => adapter.list_models().await.unwrap_or_default(),
                None => Vec::new(),
            }
        })
    }
}

/// A `Send + Sync` `ContextDb` that routes `context-tracker`'s synchronous
/// `db.chats.*` reads/writes through the actor bridge.
struct CtxDbHandle {
    db: Db,
}

impl ContextDb for CtxDbHandle {
    fn add_mention(&self, chat_id: &str, mention: &SessionMention) -> bool {
        let (id, mention) = (chat_id.to_string(), mention.clone());
        self.db
            .call_blocking(move |d| d.chats.add_mention(&id, &mention))
            .unwrap_or(false)
    }

    fn get_mentions(&self, chat_id: &str) -> Vec<SessionMention> {
        let id = chat_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get_mentions(&id))
            .unwrap_or_default()
    }

    fn get_plan_files(&self, chat_id: &str) -> Vec<String> {
        let id = chat_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get_plan_files(&id))
            .unwrap_or_default()
    }

    fn get_skill_files(&self, chat_id: &str) -> Vec<SkillFileEntry> {
        let id = chat_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get_skill_files(&id))
            .unwrap_or_default()
    }
}

/// Ported from the post-`loadHistory` scan in `doLoadChat`
/// (`packages/core/src/chat/lifecycle-manager.ts`): `@`-mention extraction over
/// `@`-mention extraction over user text — the first half of the post-
/// `loadHistory` scan in `doLoadChat` (`packages/core/src/chat/lifecycle-manager.ts`).
/// Persists through `ctx_db` as a side effect (mirrors `db.chats.addMention`).
fn scan_history_for_mentions(chat_id: &str, history: &[ChatMessage], ctx_db: &dyn ContextDb) {
    for msg in history {
        if msg.r#type != ChatMessageType::User {
            continue;
        }
        for block in &msg.content {
            let MessageContent::Leaf(LeafContent::Text { text, .. }) = block else {
                continue;
            };
            // Skip command/skill injections — they contain example @-patterns.
            if text.contains("<mainframe-command") || text.contains("<command-name>") {
                continue;
            }
            extract_mentions_from_text(chat_id, Some(text.as_str()), ctx_db);
        }
    }
}

/// Walk messages in order: assistant `tool_use` blocks identify PR-create
/// commands; subsequent `tool_result` blocks with PR URLs are classified as
/// `created` (matching `toolUseId`) or `mentioned` (everything else).
fn scan_history_for_prs(history: &[ChatMessage]) -> Vec<DetectedPr> {
    let mut scanned = Vec::new();
    let mut seen_prs = HashSet::new();
    let mut pending_creates = HashSet::new();
    for msg in history {
        if msg.r#type == ChatMessageType::Assistant {
            for block in &msg.content {
                let MessageContent::Node(MessageContentNode::ToolUse {
                    id, name, input, ..
                }) = block
                else {
                    continue;
                };
                if name != "Bash" && name != "BashTool" {
                    continue;
                }
                let Some(command) = input.get("command").and_then(|v| v.as_str()) else {
                    continue;
                };
                if is_pr_create_command(command) {
                    pending_creates.insert(id.clone());
                }
            }
        }
        if msg.r#type != ChatMessageType::ToolResult {
            continue;
        }
        for block in &msg.content {
            let MessageContent::Node(MessageContentNode::ToolResult {
                content,
                tool_use_id,
                ..
            }) = block
            else {
                continue;
            };
            let Some(pr) = extract_pr_from_tool_result(content) else {
                continue;
            };
            let key = format!("{}/{}/{}", pr.owner, pr.repo, pr.number);
            if !seen_prs.insert(key) {
                continue;
            }
            let source = if pending_creates.remove(tool_use_id) {
                DetectedPrSource::Created
            } else {
                DetectedPrSource::Mentioned
            };
            scanned.push(pr.with_source(source));
        }
    }
    scanned
}

/// Bridges `AttachmentStore::list` (returns `StoredAttachmentMeta`) to the
/// context-tracker's `AttachmentLister` (wants `SessionAttachment`). The stored
/// meta is a structural superset of `SessionAttachment` (drops `materializedPath`);
/// the TS passes the metas straight through, so this mirrors that projection.
struct AttachmentListerHandle {
    store: Arc<AttachmentStore>,
}

impl AttachmentLister for AttachmentListerHandle {
    fn list<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Vec<SessionAttachment>> {
        Box::pin(async move {
            self.store
                .list(chat_id)
                .await
                .into_iter()
                .map(|m| SessionAttachment {
                    id: m.id,
                    name: m.name,
                    media_type: m.media_type,
                    size_bytes: m.size_bytes,
                    kind: match m.kind {
                        AttachmentKind::Image => SessionAttachmentKind::Image,
                        AttachmentKind::File => SessionAttachmentKind::File,
                    },
                    original_path: m.original_path,
                })
                .collect()
        })
    }
}

/// Unpersisted `Chat` stub for the (near-impossible) `db.chats.create` failure —
/// mirrors the shape `ChatsRepository::create` returns on success. Also the
/// automations-deps tests' Chat fixture (pub(crate) for that reason).
pub(crate) fn fallback_chat(
    project_id: &str,
    adapter_id: &str,
    permission_mode: Option<&str>,
) -> Chat {
    let now = now_iso8601();
    Chat {
        id: nanoid::nanoid!(),
        adapter_id: adapter_id.to_string(),
        project_id: project_id.to_string(),
        title: None,
        claude_session_id: None,
        session_file_path: None,
        model: None,
        permission_mode: permission_mode
            .filter(|s| !s.is_empty())
            .and_then(|s| serde_json::from_value(serde_json::Value::String(s.to_string())).ok()),
        plan_mode: Some(false),
        status: ChatStatus::Active,
        created_at: now.clone(),
        updated_at: now,
        total_cost: 0.0,
        total_tokens_input: 0,
        total_tokens_output: 0,
        last_context_tokens_input: 0,
        last_context_total_tokens: None,
        last_context_max_tokens: None,
        transcript_missing: None,
        background_activity: None,
        context_files: None,
        mentions: None,
        modified_files: None,
        worktree_path: None,
        branch_name: None,
        process_state: None,
        display_status: None,
        is_running: None,
        worktree_missing: None,
        todos: None,
        pinned: None,
        effort: None,
        fast: None,
        ultracode: None,
        adaptive_thinking: None,
        detected_prs: None,
        tags: None,
        automation_run_id: None,
    }
}

#[cfg(test)]
mod scan_loaded_history_tests {
    use std::collections::HashMap as StdHashMap;
    use std::sync::Mutex as StdMutex;

    use mainframe_adapter_api::{AdapterError, ContextFiles, ImageInput, SessionSink};
    use mainframe_background_tasks::tracker::BackgroundTaskTracker;
    use mainframe_db::DatabaseManager;
    use mainframe_types::adapter::{AdapterProcess, ControlResponse, SessionSpawnOptions};
    use mainframe_types::context::MentionKind;

    use super::*;
    use crate::chat_seams::NoopLaunchStopper;

    fn text_msg(id: &str, r#type: ChatMessageType, text: &str) -> ChatMessage {
        ChatMessage {
            id: id.to_string(),
            chat_id: "c1".to_string(),
            r#type,
            content: vec![MessageContent::Leaf(LeafContent::Text {
                text: text.to_string(),
                parent_tool_use_id: None,
            })],
            timestamp: "2026-01-01T00:00:00.000Z".to_string(),
            metadata: None,
        }
    }

    fn tool_use_msg(id: &str, tool_use_id: &str, name: &str, command: &str) -> ChatMessage {
        let mut input = StdHashMap::new();
        input.insert(
            "command".to_string(),
            serde_json::Value::String(command.to_string()),
        );
        ChatMessage {
            id: id.to_string(),
            chat_id: "c1".to_string(),
            r#type: ChatMessageType::Assistant,
            content: vec![MessageContent::Node(MessageContentNode::ToolUse {
                id: tool_use_id.to_string(),
                name: name.to_string(),
                input,
                parent_tool_use_id: None,
            })],
            timestamp: "2026-01-01T00:00:01.000Z".to_string(),
            metadata: None,
        }
    }

    fn tool_result_msg(id: &str, tool_use_id: &str, content: &str) -> ChatMessage {
        ChatMessage {
            id: id.to_string(),
            chat_id: "c1".to_string(),
            r#type: ChatMessageType::ToolResult,
            content: vec![MessageContent::Node(MessageContentNode::ToolResult {
                tool_use_id: tool_use_id.to_string(),
                content: content.to_string(),
                is_error: false,
                structured_patch: None,
                original_file: None,
                modified_file: None,
                parent_tool_use_id: None,
            })],
            timestamp: "2026-01-01T00:00:02.000Z".to_string(),
            metadata: None,
        }
    }

    // -- scan_history_for_prs --------------------------------------------

    #[test]
    fn scan_history_for_prs_marks_source_created_when_tool_use_id_matches_a_pending_gh_pr_create() {
        let history = vec![
            tool_use_msg("m1", "tu1", "Bash", "gh pr create --title x"),
            tool_result_msg("m2", "tu1", "Created https://github.com/acme/repo/pull/7"),
        ];
        let scanned = scan_history_for_prs(&history);
        assert_eq!(
            scanned,
            vec![DetectedPr {
                url: "https://github.com/acme/repo/pull/7".to_string(),
                owner: "acme".to_string(),
                repo: "repo".to_string(),
                number: 7,
                source: DetectedPrSource::Created,
            }]
        );
    }

    #[test]
    fn scan_history_for_prs_marks_source_mentioned_without_a_matching_pending_create() {
        let history = vec![tool_result_msg(
            "m1",
            "tu-unrelated",
            "See https://github.com/acme/repo/pull/9 for context",
        )];
        let scanned = scan_history_for_prs(&history);
        assert_eq!(
            scanned,
            vec![DetectedPr {
                url: "https://github.com/acme/repo/pull/9".to_string(),
                owner: "acme".to_string(),
                repo: "repo".to_string(),
                number: 9,
                source: DetectedPrSource::Mentioned,
            }]
        );
    }

    #[test]
    fn scan_history_for_prs_dedupes_the_same_pr_seen_in_two_tool_results() {
        let history = vec![
            tool_result_msg("m1", "tu1", "https://github.com/acme/repo/pull/3"),
            tool_result_msg("m2", "tu2", "https://github.com/acme/repo/pull/3 again"),
        ];
        assert_eq!(scan_history_for_prs(&history).len(), 1);
    }

    #[test]
    fn scan_history_for_prs_returns_empty_when_no_pr_url_present() {
        let history = vec![tool_result_msg("m1", "tu1", "no PR here")];
        assert!(scan_history_for_prs(&history).is_empty());
    }

    // -- scan_history_for_mentions ----------------------------------------

    #[derive(Default)]
    struct RecordingCtxDb {
        added: StdMutex<Vec<SessionMention>>,
    }

    impl ContextDb for RecordingCtxDb {
        fn add_mention(&self, _chat_id: &str, mention: &SessionMention) -> bool {
            self.added.lock().unwrap().push(mention.clone());
            true
        }
        fn get_mentions(&self, _chat_id: &str) -> Vec<SessionMention> {
            Vec::new()
        }
        fn get_plan_files(&self, _chat_id: &str) -> Vec<String> {
            Vec::new()
        }
        fn get_skill_files(&self, _chat_id: &str) -> Vec<SkillFileEntry> {
            Vec::new()
        }
    }

    #[test]
    fn scan_history_for_mentions_extracts_at_reference_from_user_text() {
        let history = vec![text_msg(
            "m1",
            ChatMessageType::User,
            "please review @src/foo.ts",
        )];
        let ctx_db = RecordingCtxDb::default();
        scan_history_for_mentions("c1", &history, &ctx_db);
        let added = ctx_db.added.lock().unwrap();
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].kind, MentionKind::File);
        assert_eq!(added[0].name, "foo.ts");
        assert_eq!(added[0].path.as_deref(), Some("src/foo.ts"));
    }

    #[test]
    fn scan_history_for_mentions_skips_mainframe_command_injection_blocks() {
        let history = vec![text_msg(
            "m1",
            ChatMessageType::User,
            "<mainframe-command>@src/foo.ts</mainframe-command>",
        )];
        let ctx_db = RecordingCtxDb::default();
        scan_history_for_mentions("c1", &history, &ctx_db);
        assert!(ctx_db.added.lock().unwrap().is_empty());
    }

    #[test]
    fn scan_history_for_mentions_ignores_non_user_messages() {
        let history = vec![text_msg("m1", ChatMessageType::Assistant, "@src/foo.ts")];
        let ctx_db = RecordingCtxDb::default();
        scan_history_for_mentions("c1", &history, &ctx_db);
        assert!(ctx_db.added.lock().unwrap().is_empty());
    }

    // -- full DaemonChatDeps harness (scan_and_persist_prs / plan+skill files) --

    struct NoopQuotaSettings;
    impl mainframe_services::quota::QuotaSettingsStore for NoopQuotaSettings {
        fn get(&self, _category: &str, _key: &str) -> Option<String> {
            None
        }
        fn get_by_category(&self, _category: &str) -> StdHashMap<String, String> {
            StdHashMap::new()
        }
        fn set(&self, _category: &str, _key: &str, _value: &str) {}
    }

    fn test_deps() -> DaemonChatDeps {
        let db = Db::spawn(|| DatabaseManager::open(std::path::Path::new(":memory:"))).unwrap();
        // `emit_event` ignores the "no subscribers" send error, so the
        // constructor's own receiver can be dropped immediately.
        let (broadcast, _rx) = broadcast::channel::<DaemonEvent>(16);
        let quota = QuotaManager::new(mainframe_services::quota::QuotaManagerDeps {
            settings: Box::new(NoopQuotaSettings),
            emit_event: Box::new(|_| {}),
            now: None,
        });
        DaemonChatDeps {
            db,
            adapters: Arc::new(AdapterRegistry::new()),
            background_tasks: Arc::new(BackgroundTaskTracker::new()),
            attachments: Arc::new(AttachmentStore::new(
                std::env::temp_dir().join("mf-chat-deps-test"),
            )),
            push: Arc::new(PushService::new()),
            git: GitFactory,
            broadcast,
            launch: Arc::new(NoopLaunchStopper),
            quota: Arc::new(quota),
        }
    }

    #[test]
    fn scan_and_persist_prs_persists_a_new_pr_and_emits_chat_pr_detected() {
        let deps = test_deps();
        let project = deps
            .db
            .call_blocking(|d| d.projects.create("/tmp/p1", None))
            .unwrap();
        let chat = deps
            .db
            .call_blocking(move |d| d.chats.create(&project.id, "claude", None, None, None))
            .unwrap();
        let mut rx = deps.broadcast.subscribe();

        let history = vec![tool_result_msg(
            "m1",
            "tu1",
            "https://github.com/acme/repo/pull/42",
        )];
        deps.scan_and_persist_prs(&chat.id, &history);

        let persisted = deps
            .db
            .call_blocking({
                let id = chat.id.clone();
                move |d| d.chats.get_detected_prs(&id)
            })
            .unwrap();
        assert_eq!(
            persisted,
            vec![DetectedPr {
                url: "https://github.com/acme/repo/pull/42".to_string(),
                owner: "acme".to_string(),
                repo: "repo".to_string(),
                number: 42,
                source: DetectedPrSource::Mentioned,
            }]
        );

        let event = rx.try_recv().expect("chat.prDetected should be emitted");
        match event {
            DaemonEvent::ChatPrDetected { chat_id, pr } => {
                assert_eq!(chat_id, chat.id);
                assert_eq!(pr.number, 42);
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    struct PlanSkillSession {
        plan_paths: Vec<String>,
        skill_paths: Vec<SkillFileEntry>,
    }

    impl AdapterSession for PlanSkillSession {
        fn id(&self) -> &str {
            "sess"
        }
        fn adapter_id(&self) -> &str {
            "claude"
        }
        fn project_path(&self) -> &str {
            "/tmp"
        }
        fn is_spawned(&self) -> bool {
            false
        }
        fn spawn(
            &self,
            _options: Option<SessionSpawnOptions>,
            _sink: Option<Arc<dyn SessionSink>>,
        ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
            Box::pin(async { Err(AdapterError::Message("unused".to_string())) })
        }
        fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
            Box::pin(async { Ok(()) })
        }
        fn get_process_info(&self) -> Option<AdapterProcess> {
            None
        }
        fn send_message(
            &self,
            _message: String,
            _images: Vec<ImageInput>,
            _uuid: Option<String>,
        ) -> BoxFuture<'_, Result<(), AdapterError>> {
            Box::pin(async { Ok(()) })
        }
        fn respond_to_permission(
            &self,
            _response: ControlResponse,
        ) -> BoxFuture<'_, Result<(), AdapterError>> {
            Box::pin(async { Ok(()) })
        }
        fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
            Box::pin(async { Ok(()) })
        }
        fn set_model(&self, _model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
            Box::pin(async { Ok(()) })
        }
        fn set_permission_mode(
            &self,
            _mode: mainframe_types::settings::ExecutionMode,
        ) -> BoxFuture<'_, Result<(), AdapterError>> {
            Box::pin(async { Ok(()) })
        }
        fn set_plan_mode(&self, _on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
            Box::pin(async { Ok(()) })
        }
        fn send_command(
            &self,
            _command: String,
            _args: Option<String>,
        ) -> BoxFuture<'_, Result<(), AdapterError>> {
            Box::pin(async { Ok(()) })
        }
        fn cancel_queued_message(
            &self,
            _uuid: String,
        ) -> BoxFuture<'_, Result<bool, AdapterError>> {
            Box::pin(async { Ok(false) })
        }
        fn get_context_files(&self) -> ContextFiles {
            ContextFiles {
                global: Vec::new(),
                project: Vec::new(),
            }
        }
        fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>> {
            let paths = self.plan_paths.clone();
            Box::pin(async move { Ok(paths) })
        }
        fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>> {
            let entries = self.skill_paths.clone();
            Box::pin(async move { Ok(entries) })
        }
        fn stop_background_task(
            &self,
            _task_id: String,
        ) -> BoxFuture<'_, Result<mainframe_adapter_api::StopBackgroundTaskResult, AdapterError>>
        {
            Box::pin(async {
                Ok(mainframe_adapter_api::StopBackgroundTaskResult {
                    ok: false,
                    error: Some("unsupported".to_string()),
                })
            })
        }
    }

    #[tokio::test]
    async fn persist_plan_and_skill_files_writes_both_extracted_lists() {
        let deps = test_deps();
        let project = deps
            .db
            .call_blocking(|d| d.projects.create("/tmp/p1", None))
            .unwrap();
        let chat = deps
            .db
            .call_blocking(move |d| d.chats.create(&project.id, "claude", None, None, None))
            .unwrap();
        let session = PlanSkillSession {
            plan_paths: vec!["/repo/PLAN.md".to_string()],
            skill_paths: vec![SkillFileEntry {
                path: "/repo/.claude/skills/tdd/SKILL.md".to_string(),
                display_name: "tdd".to_string(),
            }],
        };

        deps.persist_plan_and_skill_files(&chat.id, &session).await;

        let plan_files = deps
            .db
            .call_blocking({
                let id = chat.id.clone();
                move |d| d.chats.get_plan_files(&id)
            })
            .unwrap();
        assert_eq!(plan_files, vec!["/repo/PLAN.md".to_string()]);

        let skill_files = deps
            .db
            .call_blocking({
                let id = chat.id.clone();
                move |d| d.chats.get_skill_files(&id)
            })
            .unwrap();
        assert_eq!(
            skill_files,
            vec![SkillFileEntry {
                path: "/repo/.claude/skills/tdd/SKILL.md".to_string(),
                display_name: "tdd".to_string(),
            }]
        );
    }
}

// PORT STATUS: (new — production ChatManagerDeps wiring for chat/chat-manager.ts
// constructor injection + index.ts `new ChatManager(...)`)
// confidence: medium
// todos: 3
// notes: The one production impl of ChatManagerDeps. DB accessors go through the
// SYNC-DB BRIDGE (Db::call_blocking) — one WAL connection. notifications / per-chat
// todos / push / mentions / tuning / title / kill / worktree-remove are wired to
// the real ported helpers (RtDeps + CtxDbHandle bridge the generic helper trait
// bounds through the actor). Task 5.4 added chats_list_filtered (translates to the db
// ChatListFilters), chats_add_mention (db write), and get_session_context (runs the
// context-tracker read with the AdapterRegistry + an AttachmentListerHandle over the
// AttachmentStore). scanLoadedHistory now runs the ported pr-detection scan +
// mention extraction + plan/skill-file persistence by re-deriving a session from
// the chat row (session_for_scan) since the trait only carries chatId; see that
// method's doc comment for the fidelity tradeoff. Seams (TODO(port)):
// applyCodexProviderTuning (codex-only session method, Phase 5),
// stopLaunchProcesses (LaunchStopper seam, Phase 5). chats_create is infallible
// per the ported trait; a DB failure logs + returns an unpersisted stub.
// notes: ExternalSessionDeps (external-session-service.ts's DI surface) is also
// implemented here and wired into `build_chat_manager` via
// `ExternalSessionService::new(deps.clone())` + `ChatManager::with_external_sessions`.
// `listExternalSessions` is not on the polymorphic Adapter trait (adapter-api TODO),
// so `list_external_sessions` dispatches to the concrete
// `mainframe_adapter_claude`/`mainframe_adapter_codex` free functions by id rather
// than through the registry; `external_session_adapter_ids` mirrors the TS capability
// filter as a hardcoded {claude, codex} id allowlist intersected with what is
// actually registered. `claude_external_session_cache` is the process-lifetime,
// injected (not module-singleton) enrichment cache the Claude scan needs.
// `reconcile_transcript` is left at the trait's own `None` default (no
// ChatManager.reconcileTranscript wiring) — out of this gap's scope; the
// transcript-presence sweep is a no-op until that lands.
