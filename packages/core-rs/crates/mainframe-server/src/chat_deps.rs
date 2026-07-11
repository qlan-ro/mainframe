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

use std::sync::Arc;

use mainframe_adapter_api::{AdapterRegistry, AdapterSession, BoxFuture};
use mainframe_adapter_claude::messages::display_pipeline::prepare_messages_for_client;
use mainframe_adapter_claude::messages::message_parsing::strip_mainframe_command_tags;
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
use mainframe_chat::event_handler::PushOut;
use mainframe_chat::resolve_tuning_for_chat::{ResolveTuningDeps, resolve_tuning_for_chat};
use mainframe_chat::title_generator::generate_title;
use mainframe_runtime::ResolvedPath;
use mainframe_runtime::time::now_iso8601;
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::attachment::attachment_store::AttachmentKind;
use mainframe_services::notifications::notification_config::{
    read_notification_config, should_notify_permission,
};
use mainframe_services::push::PushService;
use mainframe_services::push::push_service::{PushMessage, PushPriority};
use mainframe_services::settings::provider_config::SettingsReader;
use mainframe_types::adapter::{AdapterModel, DetectedPr, SessionOptions};
use mainframe_types::chat::{Chat, ChatMessage, ChatStatus, ResolvedTuning, TodoItem};
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
    /// Boot-resolved login-shell `PATH`, applied to the title-generation CLI spawn
    /// (mirrors the TS `enrichPath` env mutation).
    resolved_path: ResolvedPath,
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
    ) -> Chat {
        let (pid, aid) = (project_id.to_string(), adapter_id.to_string());
        let model = model.map(str::to_string);
        let mode = permission_mode.map(str::to_string);
        let created = self.db.call_blocking(move |d| {
            d.chats
                .create(&pid, &aid, model.as_deref(), mode.as_deref())
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
        _attachment_ids: &'a [String],
    ) -> BoxFuture<'a, ProcessedAttachments> {
        Box::pin(async move {
            // TODO(port): attachment-processor.ts is not yet ported (skeleton in
            // mainframe_chat::attachment_processor). Until it lands, no attachment
            // is materialised — faithful to "no attachments" (the send path still
            // delivers the text content).
            tracing::warn!(
                chat_id,
                "processAttachments seam: attachment-processor not ported — dropping attachments"
            );
            ProcessedAttachments::default()
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
            // TODO(port): the post-loadHistory scan (mention extraction + PR-URL
            // detection + plan/skill-file extraction) needs the live session handle
            // and the unported `pr-detection.ts`; the ported `scan_loaded_history`
            // dep receives only the chatId, so it cannot re-acquire the session.
            // No-op preserves history loading; a resumed chat simply is not
            // re-scanned until this and pr-detection are ported.
            tracing::debug!(
                chat_id,
                "scanLoadedHistory seam: pr-detection unported and no session handle — no-op"
            );
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
        content: &'a str,
        binary: &'a str,
    ) -> BoxFuture<'a, Option<String>> {
        let path = self.resolved_path.clone();
        Box::pin(async move {
            match generate_title(content, binary, path.as_str()).await {
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
    resolved_path: ResolvedPath,
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
        resolved_path,
    });
    Arc::new(ChatManager::new(deps))
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
/// mirrors the shape `ChatsRepository::create` returns on success.
fn fallback_chat(project_id: &str, adapter_id: &str, permission_mode: Option<&str>) -> Chat {
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
    }
}

// PORT STATUS: (new — production ChatManagerDeps wiring for chat/chat-manager.ts
// constructor injection + index.ts `new ChatManager(...)`)
// confidence: medium
// todos: 4
// notes: The one production impl of ChatManagerDeps. DB accessors go through the
// SYNC-DB BRIDGE (Db::call_blocking) — one WAL connection. notifications / per-chat
// todos / push / mentions / tuning / title / kill / worktree-remove are wired to
// the real ported helpers (RtDeps + CtxDbHandle bridge the generic helper trait
// bounds through the actor). Task 5.4 added chats_list_filtered (translates to the db
// ChatListFilters), chats_add_mention (db write), and get_session_context (runs the
// context-tracker read with the AdapterRegistry + an AttachmentListerHandle over the
// AttachmentStore). Seams (TODO(port)): processAttachments
// (attachment-processor unported), scanLoadedHistory (pr-detection unported + no
// session handle), applyCodexProviderTuning (codex-only session method, Phase 5),
// stopLaunchProcesses (LaunchStopper seam, Phase 5). chats_create is infallible
// per the ported trait; a DB failure logs + returns an unpersisted stub.
