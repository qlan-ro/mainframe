//! Ported from `packages/core/src/chat/chat-manager.ts`.
//!
//! The TS `ChatManager` owns `messages`/`permissions`/`activeChats`/`queuedRefs`
//! and wires the sub-managers with closures over `this`. The Rust port keeps the
//! shared PER_ENTITY caches behind `Arc<Mutex<..>>` / `Arc<DashMap<..>>` and wires
//! the sub-managers with concrete delegating `Deps` wrappers (`EhDeps`/`LcDeps`/
//! `PhDeps`) that all hold the SAME `Arc<dyn ChatManagerDeps>` + shared state — the
//! Rust analogue of the TS closure bag. Non-generic (`dyn ChatManagerDeps`) to
//! avoid generic self-recursion in the wiring.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use dashmap::DashMap;
use mainframe_adapter_api::{AdapterError, AdapterSession, BoxFuture, ImageInput, SessionSink};
use mainframe_runtime::time::now_iso8601;
use mainframe_services::commands::{find_mainframe_command, wrap_mainframe_command};
use mainframe_services::workspace::is_worktree_present;
use mainframe_types::adapter::{ControlResponse, DetectedPr};
use mainframe_types::chat::{
    Chat, ChatMessage, ChatMessageType, DisplayStatus, MessageContent, ProcessState,
    QueuedMessageRef, TodoItem,
};
use mainframe_types::content::LeafContent;
use mainframe_types::context::SkillFileEntry;
use mainframe_types::display::{DisplayMessage, ToolCategories};
use mainframe_types::events::DaemonEvent;
use tracing::info;

use crate::event_handler::{EventChatUpdate, EventHandler, EventHandlerDeps, PushOut};
use crate::lifecycle_manager::{ChatLifecycleManager, LifecycleChatUpdate, LifecycleManagerDeps};
use crate::message_cache::MessageCache;
use crate::permission_handler::{ChatPermissionHandler, PermissionError, PermissionHandlerDeps};
use crate::permission_manager::PermissionManager;
use crate::title_generator::derive_title_from_message;
use crate::types::ActiveChat;

/// Result of `processAttachments` (attachment-processor.ts is a separate port
/// target; the shape is mirrored here for the sendMessage seam).
#[derive(Debug, Clone, Default)]
pub struct ProcessedAttachments {
    pub images: Vec<ImageInput>,
    pub message_content: Vec<MessageContent>,
    pub text_prefix: Vec<String>,
    /// Opaque preview objects (`attachmentPreviews`), stored as JSON for the
    /// transient metadata; their shape is owned by the attachment layer.
    pub attachment_previews: Vec<serde_json::Value>,
}

/// Unified `db.chats.update` patch (superset of the sub-manager patch structs).
/// Tri-state fields use `Some(None)` for an explicit null.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ChatUpdate {
    pub adapter_id: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<mainframe_types::settings::ExecutionMode>,
    pub plan_mode: Option<bool>,
    pub claude_session_id: Option<String>,
    pub session_file_path: Option<String>,
    pub worktree_path: Option<Option<String>>,
    pub branch_name: Option<Option<String>>,
    pub total_cost: Option<f64>,
    pub total_tokens_input: Option<i64>,
    pub total_tokens_output: Option<i64>,
    pub last_context_tokens_input: Option<i64>,
    pub process_state: Option<Option<ProcessState>>,
    pub updated_at: Option<String>,
    pub title: Option<String>,
    pub status: Option<mainframe_types::chat::ChatStatus>,
}

impl From<&EventChatUpdate> for ChatUpdate {
    fn from(e: &EventChatUpdate) -> Self {
        ChatUpdate {
            claude_session_id: e.claude_session_id.clone(),
            session_file_path: e.session_file_path.clone(),
            plan_mode: e.plan_mode,
            total_cost: e.total_cost,
            total_tokens_input: e.total_tokens_input,
            total_tokens_output: e.total_tokens_output,
            last_context_tokens_input: e.last_context_tokens_input,
            process_state: e.process_state,
            updated_at: e.updated_at.clone(),
            ..Default::default()
        }
    }
}

impl From<&LifecycleChatUpdate> for ChatUpdate {
    fn from(l: &LifecycleChatUpdate) -> Self {
        ChatUpdate {
            worktree_path: l.worktree_path.clone(),
            branch_name: l.branch_name.clone(),
            plan_mode: l.plan_mode,
            title: l.title.clone(),
            status: l.status,
            ..Default::default()
        }
    }
}

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
    ) -> Chat;
    fn chats_update(&self, chat_id: &str, patch: &ChatUpdate);
    fn chats_list(&self, project_id: &str) -> Vec<Chat>;
    fn chats_list_all(&self) -> Vec<Chat>;
    fn chats_reset_working_to_idle(&self) -> i64;
    fn projects_get_path(&self, project_id: &str) -> Option<String>;
    fn projects_remove(&self, project_id: &str);
    fn settings_get(&self, ns: &str, key: &str) -> Option<String>;
    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> bool;
    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> bool;
    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]);
    fn add_detected_prs(&self, chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr>;

    fn create_session(
        &self,
        adapter_id: &str,
        options: mainframe_types::adapter::SessionOptions,
    ) -> Option<Arc<dyn AdapterSession>>;

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
    fn scan_loaded_history<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    fn resolve_tuning<'a>(
        &'a self,
        chat_id: &'a str,
    ) -> BoxFuture<'a, Option<mainframe_types::chat::ResolvedTuning>>;
    fn apply_codex_provider_tuning(&self, session: &Arc<dyn AdapterSession>);
    fn generate_title<'a>(
        &'a self,
        content: &'a str,
        binary: &'a str,
    ) -> BoxFuture<'a, Option<String>>;
    fn is_working_tree_dirty<'a>(&'a self, project_path: &'a str) -> BoxFuture<'a, bool>;
    fn path_exists(&self, path: &str) -> bool;

    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool;
    fn notify_task_complete(&self) -> bool;
    fn notify_session_error(&self) -> bool;
    fn send_push(&self, _msg: PushOut) {}

    /// `extractMentionsFromText(chatId, text, db)` — returns whether any mention
    /// was newly recorded (Claude-agnostic but db-backed → injected).
    fn extract_mentions_from_text(&self, chat_id: &str, text: &str) -> bool;
    fn tracker_remove_chat(&self, chat_id: &str);
}

type Registry = Arc<DashMap<String, Arc<Mutex<ActiveChat>>>>;
type QueuedRefs = Arc<Mutex<HashMap<String, QueuedMessageRef>>>;

fn is_working(chat: &Chat) -> bool {
    chat.process_state == Some(Some(ProcessState::Working))
}

/// `enrichChat` — set displayStatus/isRunning/worktreeMissing (mutates in place).
fn enrich_chat(chat: &mut Chat, has_pending: bool) {
    let working = is_working(chat);
    chat.display_status = Some(if has_pending {
        DisplayStatus::Waiting
    } else if working {
        DisplayStatus::Working
    } else {
        DisplayStatus::Idle
    });
    chat.is_running = Some(working && !has_pending);
    chat.worktree_missing = Some(
        chat.worktree_path
            .as_ref()
            .map(|p| !is_worktree_present(p))
            .unwrap_or(false),
    );
}

/// Enrich chat.updated/chat.created then emit through the raw `onEvent`.
fn enrich_and_emit(
    deps: &dyn ChatManagerDeps,
    permissions: &Arc<Mutex<PermissionManager>>,
    mut event: DaemonEvent,
) {
    match &mut event {
        DaemonEvent::ChatUpdated { chat, .. } | DaemonEvent::ChatCreated { chat, .. } => {
            let has_pending = permissions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .has_pending(&chat.id);
            enrich_chat(chat, has_pending);
        }
        _ => {}
    }
    deps.emit_event(event);
}

// ── sub-manager Deps wrappers ────────────────────────────────────────────────

struct EhDeps {
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: Registry,
    permissions: Arc<Mutex<PermissionManager>>,
    queued_refs: QueuedRefs,
}

impl EventHandlerDeps for EhDeps {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.active_chats.get(chat_id).map(|e| e.value().clone())
    }
    fn emit_event(&self, event: DaemonEvent) {
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
    }
    fn get_tool_categories(&self, chat_id: &str) -> Option<ToolCategories> {
        self.deps.get_tool_categories(chat_id)
    }
    fn on_queued_processed(&self, chat_id: &str, uuid: &str) {
        handle_queued_processed(&self.queued_refs, chat_id, uuid);
    }
    fn on_queued_cleared(&self, chat_id: &str) {
        clear_all_queued_for_chat(&self.queued_refs, chat_id);
    }
    fn get_queued_refs(&self, chat_id: &str) -> Vec<QueuedMessageRef> {
        queued_for_chat(&self.queued_refs, chat_id)
    }
    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        self.deps.prepare_messages_for_client(raw, categories)
    }
    fn strip_command_tags(&self, text: &str) -> String {
        self.deps.strip_command_tags(text)
    }
    fn chats_update(&self, chat_id: &str, patch: &EventChatUpdate) {
        self.deps.chats_update(chat_id, &ChatUpdate::from(patch));
    }
    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        self.deps.projects_get_path(project_id)
    }
    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> bool {
        self.deps.add_plan_file(chat_id, file_path)
    }
    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> bool {
        self.deps.add_skill_file(chat_id, entry)
    }
    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]) {
        self.deps.update_todos(chat_id, todos);
    }
    fn add_detected_prs(&self, chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr> {
        self.deps.add_detected_prs(chat_id, prs)
    }
    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool {
        self.deps.should_notify_permission(tool_name)
    }
    fn notify_task_complete(&self) -> bool {
        self.deps.notify_task_complete()
    }
    fn notify_session_error(&self) -> bool {
        self.deps.notify_session_error()
    }
    fn send_push(&self, msg: PushOut) {
        self.deps.send_push(msg);
    }
}

struct LcDeps {
    deps: Arc<dyn ChatManagerDeps>,
    permissions: Arc<Mutex<PermissionManager>>,
    event_handler: Arc<EventHandler<EhDeps>>,
}

impl LifecycleManagerDeps for LcDeps {
    fn chats_get(&self, id: &str) -> Option<Chat> {
        self.deps.chats_get(id)
    }
    fn chats_create(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
    ) -> Chat {
        self.deps
            .chats_create(project_id, adapter_id, model, permission_mode)
    }
    fn chats_update(&self, chat_id: &str, patch: &LifecycleChatUpdate) {
        self.deps.chats_update(chat_id, &ChatUpdate::from(patch));
    }
    fn chats_list(&self, project_id: &str) -> Vec<Chat> {
        self.deps.chats_list(project_id)
    }
    fn projects_get_path(&self, project_id: &str) -> Option<String> {
        self.deps.projects_get_path(project_id)
    }
    fn settings_get(&self, ns: &str, key: &str) -> Option<String> {
        self.deps.settings_get(ns, key)
    }
    fn create_session(
        &self,
        adapter_id: &str,
        options: mainframe_types::adapter::SessionOptions,
    ) -> Option<Arc<dyn AdapterSession>> {
        self.deps.create_session(adapter_id, options)
    }
    fn build_sink(&self, chat_id: &str, session_id: &str) -> Arc<dyn SessionSink> {
        self.event_handler
            .build_sink(chat_id, Some(session_id.to_string()))
    }
    fn emit_event(&self, event: DaemonEvent) {
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
    }
    fn attachment_delete_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        self.deps.attachment_delete_chat(chat_id)
    }
    fn kill_tasks_for_chat<'a>(
        &'a self,
        chat_id: &'a str,
        worktree_path: Option<String>,
        session: Option<Arc<dyn AdapterSession>>,
    ) -> BoxFuture<'a, ()> {
        self.deps
            .kill_tasks_for_chat(chat_id, worktree_path, session)
    }
    fn remove_worktree<'a>(
        &'a self,
        project_path: &'a str,
        worktree_path: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, ()> {
        self.deps
            .remove_worktree(project_path, worktree_path, branch_name)
    }
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        self.deps.stop_launch_processes(project_id, effective_path)
    }
    fn scan_loaded_history<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        self.deps.scan_loaded_history(chat_id)
    }
    fn resolve_tuning<'a>(
        &'a self,
        chat_id: &'a str,
    ) -> BoxFuture<'a, Option<mainframe_types::chat::ResolvedTuning>> {
        self.deps.resolve_tuning(chat_id)
    }
    fn apply_codex_provider_tuning(&self, session: &Arc<dyn AdapterSession>) {
        self.deps.apply_codex_provider_tuning(session);
    }
    fn generate_title<'a>(
        &'a self,
        content: &'a str,
        binary: &'a str,
    ) -> BoxFuture<'a, Option<String>> {
        self.deps.generate_title(content, binary)
    }
    fn is_working_tree_dirty<'a>(&'a self, project_path: &'a str) -> BoxFuture<'a, bool> {
        self.deps.is_working_tree_dirty(project_path)
    }
    fn path_exists(&self, path: &str) -> bool {
        self.deps.path_exists(path)
    }
}

struct PhDeps {
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: Registry,
    permissions: Arc<Mutex<PermissionManager>>,
    event_handler: Arc<EventHandler<EhDeps>>,
    lifecycle: Arc<ChatLifecycleManager<LcDeps>>,
}

impl PermissionHandlerDeps for PhDeps {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.active_chats.get(chat_id).map(|e| e.value().clone())
    }
    fn start_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.lifecycle.start_chat(chat_id).await })
    }
    fn emit_event(&self, event: DaemonEvent) {
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
    }
    fn emit_display(&self, chat_id: &str) {
        self.event_handler.emit_display(chat_id);
    }
    fn chats_update(&self, chat_id: &str, patch: &EventChatUpdate) {
        self.deps.chats_update(chat_id, &ChatUpdate::from(patch));
    }
    fn get_messages<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, Vec<ChatMessage>> {
        // getPendingPermission calls getMessages to restore permission state from
        // JSONL. That restore is Claude-specific (loadHistory) and lives on the
        // getMessages facade; the permission FIFO is otherwise already populated.
        // TODO(port): route through ChatManager::get_messages once the history
        // loader seam is wired into the server-integration phase.
        Box::pin(async { Vec::new() })
    }
    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool {
        self.deps.should_notify_permission(tool_name)
    }
    fn send_push(&self, msg: PushOut) {
        self.deps.send_push(msg);
    }
    fn plan_mode_handle_no_process(
        &self,
        _chat_id: &str,
        _active: &Arc<Mutex<ActiveChat>>,
        _response: &ControlResponse,
    ) {
        // TODO(port): forward to PlanModeHandler.handle_no_process once plan_mode
        // is wired (needs the adapter's createPlanModeHandler, deferred on the
        // Adapter trait). No-op preserves the non-plan permission path.
    }
    fn plan_mode_handle_clear_context<'a>(
        &'a self,
        _chat_id: &'a str,
        _active: Arc<Mutex<ActiveChat>>,
        _response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        // TODO(port): forward to PlanModeHandler.handle_clear_context.
        Box::pin(async { Ok(()) })
    }
    fn plan_mode_handle_escalation<'a>(
        &'a self,
        _chat_id: &'a str,
        _active: Arc<Mutex<ActiveChat>>,
        _response: ControlResponse,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        // TODO(port): forward to PlanModeHandler.handle_escalation.
        Box::pin(async { Ok(()) })
    }
}

// ── queued-ref helpers (shared by the facade + EhDeps) ───────────────────────

fn queued_for_chat(refs: &QueuedRefs, chat_id: &str) -> Vec<QueuedMessageRef> {
    refs.lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .filter(|r| r.chat_id == chat_id)
        .cloned()
        .collect()
}

fn handle_queued_processed(refs: &QueuedRefs, chat_id: &str, uuid: &str) {
    let removed = refs.lock().unwrap_or_else(|e| e.into_inner()).remove(uuid);
    if let Some(r) = removed {
        info!(
            chat_id,
            uuid,
            message_id = r.message_id,
            "CLI processed queued message"
        );
    }
}

fn clear_all_queued_for_chat(refs: &QueuedRefs, chat_id: &str) {
    let mut guard = refs.lock().unwrap_or_else(|e| e.into_inner());
    let before = guard.len();
    guard.retain(|_, r| r.chat_id != chat_id);
    let removed = before - guard.len();
    drop(guard);
    if removed > 0 {
        info!(chat_id, removed, "cleared queued refs for exited chat");
    }
}

// ── ChatManager facade ───────────────────────────────────────────────────────

pub struct ChatManager {
    deps: Arc<dyn ChatManagerDeps>,
    active_chats: Registry,
    messages: Arc<Mutex<MessageCache>>,
    permissions: Arc<Mutex<PermissionManager>>,
    queued_refs: QueuedRefs,
    event_handler: Arc<EventHandler<EhDeps>>,
    lifecycle: Arc<ChatLifecycleManager<LcDeps>>,
    permission_handler: ChatPermissionHandler<PhDeps>,
    idle_scanner: Mutex<crate::idle_scanner::IdleSessionScanner>,
}

impl ChatManager {
    pub fn new(deps: Arc<dyn ChatManagerDeps>) -> Self {
        let active_chats: Registry = Arc::new(DashMap::new());
        let messages = Arc::new(Mutex::new(MessageCache::new()));
        let permissions = Arc::new(Mutex::new(PermissionManager::new()));
        let queued_refs: QueuedRefs = Arc::new(Mutex::new(HashMap::new()));

        let eh_deps = Arc::new(EhDeps {
            deps: deps.clone(),
            active_chats: active_chats.clone(),
            permissions: permissions.clone(),
            queued_refs: queued_refs.clone(),
        });
        let event_handler = Arc::new(EventHandler::new(
            messages.clone(),
            permissions.clone(),
            eh_deps,
        ));

        let lc_deps = Arc::new(LcDeps {
            deps: deps.clone(),
            permissions: permissions.clone(),
            event_handler: event_handler.clone(),
        });
        let lifecycle = Arc::new(ChatLifecycleManager::new(
            lc_deps,
            active_chats.clone(),
            messages.clone(),
            permissions.clone(),
        ));

        let ph_deps = PhDeps {
            deps: deps.clone(),
            active_chats: active_chats.clone(),
            permissions: permissions.clone(),
            event_handler: event_handler.clone(),
            lifecycle: lifecycle.clone(),
        };
        let permission_handler =
            ChatPermissionHandler::new(permissions.clone(), messages.clone(), ph_deps);

        let mut idle_scanner = crate::idle_scanner::IdleSessionScanner::new(active_chats.clone());
        idle_scanner.start();

        Self {
            deps,
            active_chats,
            messages,
            permissions,
            queued_refs,
            event_handler,
            lifecycle,
            permission_handler,
            idle_scanner: Mutex::new(idle_scanner),
        }
    }

    fn emit(&self, event: DaemonEvent) {
        enrich_and_emit(self.deps.as_ref(), &self.permissions, event);
    }

    fn get_active(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.active_chats.get(chat_id).map(|e| e.value().clone())
    }

    /// On boot: reset orphaned `processState: 'working'` chats to idle.
    pub fn recover_stale_working_state(&self) {
        let count = self.deps.chats_reset_working_to_idle();
        info!(count, "reset orphaned working chats to idle on boot");
    }

    /// Stop background timers. Idempotent.
    pub fn dispose(&self) {
        self.idle_scanner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .stop();
    }

    /// Exposed for tests — runs one idle-eviction pass immediately. The scanner
    /// reads the shared registry, so a transient scanner over the same registry is
    /// equivalent to the stored one (avoids holding the scanner Mutex across await).
    pub async fn scan_idle_sessions(&self) {
        crate::idle_scanner::IdleSessionScanner::new(self.active_chats.clone())
            .scan()
            .await;
    }

    pub fn get_chat(&self, chat_id: &str) -> Option<Chat> {
        let mut chat = self
            .get_active(chat_id)
            .map(|c| c.lock().unwrap_or_else(|e| e.into_inner()).chat.clone())
            .or_else(|| self.deps.chats_get(chat_id))?;
        let has_pending = self
            .permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .has_pending(chat_id);
        enrich_chat(&mut chat, has_pending);
        Some(chat)
    }

    pub fn list_chats(&self, project_id: &str) -> Vec<Chat> {
        self.deps
            .chats_list(project_id)
            .into_iter()
            .map(|mut c| {
                let hp = self
                    .permissions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .has_pending(&c.id);
                enrich_chat(&mut c, hp);
                c
            })
            .collect()
    }

    pub fn list_all_chats(&self) -> Vec<Chat> {
        self.deps
            .chats_list_all()
            .into_iter()
            .map(|mut c| {
                let hp = self
                    .permissions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .has_pending(&c.id);
                enrich_chat(&mut c, hp);
                c
            })
            .collect()
    }

    pub fn is_chat_running(&self, chat_id: &str) -> bool {
        self.get_active(chat_id)
            .map(|c| {
                c.lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .session
                    .as_ref()
                    .is_some_and(|s| s.is_spawned())
            })
            .unwrap_or(false)
    }

    pub fn get_session_for_chat(&self, chat_id: &str) -> Option<Arc<dyn AdapterSession>> {
        self.get_active(chat_id)
            .and_then(|c| c.lock().unwrap_or_else(|e| e.into_inner()).session.clone())
    }

    /// Return all queued refs for a chat, oldest-first is not guaranteed by the
    /// HashMap; the TS returns Map-insertion order but callers filter by chat only.
    pub fn get_queued_for_chat(&self, chat_id: &str) -> Vec<QueuedMessageRef> {
        queued_for_chat(&self.queued_refs, chat_id)
    }

    pub fn handle_queued_processed(&self, chat_id: &str, uuid: &str) {
        handle_queued_processed(&self.queued_refs, chat_id, uuid);
    }

    pub fn clear_all_queued_for_chat(&self, chat_id: &str) {
        clear_all_queued_for_chat(&self.queued_refs, chat_id);
    }

    // ── lifecycle delegations ────────────────────────────────────────────────
    pub async fn create_chat(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
    ) -> Chat {
        self.lifecycle
            .create_chat(project_id, adapter_id, model, permission_mode, None, None)
            .await
    }

    /// `createChatWithDefaults` — like `create_chat` but fills unset model/mode/
    /// plan-mode from the adapter's persisted provider defaults. Backs
    /// `POST /api/chats`.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_chat_with_defaults(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
        worktree_path: Option<&str>,
        branch_name: Option<&str>,
    ) -> Chat {
        self.lifecycle
            .create_chat_with_defaults(
                project_id,
                adapter_id,
                model,
                permission_mode,
                worktree_path,
                branch_name,
            )
            .await
    }

    pub async fn resume_chat(&self, chat_id: &str) {
        self.lifecycle.resume_chat(chat_id).await;
    }

    pub async fn load_chat(&self, chat_id: &str) {
        self.lifecycle.load_chat(chat_id).await;
    }

    pub async fn start_chat(&self, chat_id: &str) {
        self.lifecycle.start_chat(chat_id).await;
    }

    pub async fn interrupt_chat(&self, chat_id: &str) {
        self.lifecycle.interrupt_chat(chat_id).await;
    }

    pub async fn archive_chat(&self, chat_id: &str, delete_worktree: bool) {
        self.lifecycle.archive_chat(chat_id, delete_worktree).await;
        self.deps.tracker_remove_chat(chat_id);
        self.event_handler.clear_display_cache(chat_id);
    }

    pub async fn end_chat(&self, chat_id: &str) {
        self.lifecycle.end_chat(chat_id).await;
        self.deps.tracker_remove_chat(chat_id);
        self.event_handler.clear_display_cache(chat_id);
    }

    pub fn unarchive_chat(&self, chat_id: &str) -> Option<Chat> {
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                status: Some(mainframe_types::chat::ChatStatus::Active),
                ..Default::default()
            },
        );
        let chat = self.deps.chats_get(chat_id)?;
        self.emit(DaemonEvent::ChatUpdated {
            chat: chat.clone(),
            reason: None,
        });
        Some(chat)
    }

    pub fn rename_chat(&self, chat_id: &str, title: &str) {
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                title: Some(title.to_string()),
                ..Default::default()
            },
        );
        if let Some(cell) = self.get_active(chat_id) {
            cell.lock().unwrap_or_else(|e| e.into_inner()).chat.title = Some(title.to_string());
        }
        if let Some(chat) = self.deps.chats_get(chat_id) {
            self.emit(DaemonEvent::ChatUpdated { chat, reason: None });
        }
    }

    pub async fn respond_to_permission(
        &self,
        chat_id: &str,
        response: ControlResponse,
    ) -> Result<(), PermissionError> {
        info!(
            chat_id,
            behavior = ?response.behavior,
            tool_name = ?response.tool_name,
            "permission answered"
        );
        self.permission_handler
            .respond_to_permission(chat_id, response)
            .await
    }

    pub async fn get_pending_permission(
        &self,
        chat_id: &str,
    ) -> Option<mainframe_types::adapter::ControlRequest> {
        self.permission_handler
            .get_pending_permission(chat_id)
            .await
    }

    pub fn has_pending_permission(&self, chat_id: &str) -> bool {
        self.permission_handler.has_pending_permission(chat_id)
    }

    pub fn clear_pending_permission(&self, chat_id: &str) {
        self.permission_handler.clear_pending_permission(chat_id);
    }

    /// Remove a project and all its chats' live resources.
    pub async fn remove_project(&self, project_id: &str) {
        info!(project_id, "project removed");
        let chats = self.deps.chats_list(project_id);
        for chat in chats {
            let cell = self.get_active(&chat.id);
            let session = cell
                .as_ref()
                .and_then(|c| c.lock().unwrap_or_else(|e| e.into_inner()).session.clone());
            self.deps
                .kill_tasks_for_chat(&chat.id, chat.worktree_path.clone(), session.clone())
                .await;
            if let Some(session) = &session
                && let Err(err) = session.kill().await
            {
                tracing::warn!(
                    ?err,
                    chat_id = chat.id,
                    "session.kill failed on project removal"
                );
            }
            self.active_chats.remove(&chat.id);
            self.messages
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .delete(&chat.id);
            self.permissions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clear(&chat.id);
            self.deps.tracker_remove_chat(&chat.id);
            self.event_handler.clear_display_cache(&chat.id);
        }
        self.deps.projects_remove(project_id);
    }

    // ── the message send path + CLI-owned queue ──────────────────────────────

    pub async fn send_message(
        &self,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
        command: Option<CommandMeta>,
    ) -> Result<(), SendError> {
        let chat = self.get_chat(chat_id);
        if let Some(chat) = &chat
            && chat.worktree_missing == Some(true)
        {
            let error_msg = self.messages.lock().unwrap_or_else(|e| e.into_inner())
                .create_transient_message(
                    chat_id,
                    ChatMessageType::Error,
                    vec![MessageContent::Node(mainframe_types::chat::MessageContentNode::Error {
                        message: format!(
                            "Worktree directory no longer exists: {}. Archive this session or recreate the worktree.",
                            chat.worktree_path.as_deref().unwrap_or_default()
                        ),
                        parent_tool_use_id: None,
                    })],
                    None,
                );
            self.messages
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .append(chat_id, error_msg.clone());
            self.emit(DaemonEvent::MessageAdded {
                chat_id: chat_id.to_string(),
                message: error_msg,
            });
            self.event_handler.emit_display(chat_id);
            return Ok(());
        }

        self.lifecycle.wait_for_interrupt(chat_id).await;

        let spawned = self
            .get_active(chat_id)
            .map(|c| {
                c.lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .session
                    .as_ref()
                    .is_some_and(|s| s.is_spawned())
            })
            .unwrap_or(false);
        if !spawned {
            self.lifecycle.start_chat(chat_id).await;
        }

        let post = self
            .get_active(chat_id)
            .ok_or_else(|| SendError(format!("Chat {chat_id} not running")))?;
        let session = {
            let guard = post.lock().unwrap_or_else(|e| e.into_inner());
            match guard.session.clone() {
                Some(s) if s.is_spawned() => s,
                _ => return Err(SendError(format!("Chat {chat_id} not running"))),
            }
        };
        info!(chat_id, "user message sent");

        // Stamp turn start right before dispatch (for onResult turnDurationMs).
        post.lock()
            .unwrap_or_else(|e| e.into_inner())
            .turn_started_at = Some(now_ms());

        if let Some(cmd) = command {
            let user_message = self
                .messages
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .create_transient_message(
                    chat_id,
                    ChatMessageType::User,
                    vec![MessageContent::Leaf(LeafContent::Text {
                        text: content.to_string(),
                        parent_tool_use_id: None,
                    })],
                    None,
                );
            self.messages
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .append(chat_id, user_message.clone());
            self.emit(DaemonEvent::MessageAdded {
                chat_id: chat_id.to_string(),
                message: user_message,
            });
            self.event_handler.emit_display(chat_id);

            if cmd.source == "mainframe" {
                let resolved_args = cmd
                    .args
                    .clone()
                    .or_else(|| find_mainframe_command(&cmd.name).and_then(|c| c.prompt_template));
                let wrapped = wrap_mainframe_command(&cmd.name, content, resolved_args.as_deref());
                session.send_message(wrapped, Vec::new(), None).await?;
            } else {
                session
                    .send_command(cmd.name.clone(), cmd.args.clone())
                    .await?;
            }
            let now = now_iso8601();
            self.set_working(&post, chat_id, &now);
            let chat = post.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
            self.emit(DaemonEvent::ChatUpdated { chat, reason: None });
            return Ok(());
        }

        let processed = match attachment_ids {
            Some(ids) if !ids.is_empty() => self.deps.process_attachments(chat_id, ids).await,
            _ => ProcessedAttachments::default(),
        };
        let mut message_content = processed.message_content;
        if !content.is_empty() {
            message_content.push(MessageContent::Leaf(LeafContent::Text {
                text: content.to_string(),
                parent_tool_use_id: None,
            }));
        }
        let outgoing_content = if !processed.text_prefix.is_empty() {
            if content.is_empty() {
                processed.text_prefix.join("\n")
            } else {
                format!("{}\n\n{}", processed.text_prefix.join("\n"), content)
            }
        } else {
            content.to_string()
        };

        let adapter_acks_replay = session.supports_replay_ack();
        let is_queued = adapter_acks_replay
            && post
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .chat
                .process_state
                == Some(Some(ProcessState::Working));
        let mut transient_metadata: HashMap<String, serde_json::Value> = HashMap::new();
        if is_queued {
            transient_metadata.insert("queued".to_string(), serde_json::json!(true));
        }
        if !processed.attachment_previews.is_empty() {
            transient_metadata.insert(
                "attachments".to_string(),
                serde_json::Value::Array(processed.attachment_previews.clone()),
            );
        }
        let message_uuid = if is_queued {
            Some(nanoid::nanoid!())
        } else {
            None
        };
        if let Some(u) = &message_uuid {
            transient_metadata.insert("uuid".to_string(), serde_json::json!(u));
        }
        let message = self
            .messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .create_transient_message(
                chat_id,
                ChatMessageType::User,
                message_content,
                if transient_metadata.is_empty() {
                    None
                } else {
                    Some(transient_metadata)
                },
            );
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .append(chat_id, message.clone());
        self.emit(DaemonEvent::MessageAdded {
            chat_id: chat_id.to_string(),
            message: message.clone(),
        });
        self.event_handler.emit_display(chat_id);
        if attachment_ids.map(|a| !a.is_empty()).unwrap_or(false) {
            self.emit(DaemonEvent::ContextUpdated {
                chat_id: chat_id.to_string(),
                file_paths: None,
            });
        }

        if self.deps.extract_mentions_from_text(chat_id, content) {
            self.emit(DaemonEvent::ContextUpdated {
                chat_id: chat_id.to_string(),
                file_paths: None,
            });
        }

        let title_empty = post
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .chat
            .title
            .as_deref()
            .unwrap_or_default()
            .is_empty();
        if title_empty {
            let title = derive_title_from_message(content);
            {
                let mut guard = post.lock().unwrap_or_else(|e| e.into_inner());
                guard.chat.title = Some(title.clone());
            }
            self.deps.chats_update(
                chat_id,
                &ChatUpdate {
                    title: Some(title),
                    ..Default::default()
                },
            );
            let chat = post.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
            self.emit(DaemonEvent::ChatUpdated { chat, reason: None });
            self.lifecycle.do_generate_title(chat_id, content).await;
        }

        let now = now_iso8601();
        self.set_working(&post, chat_id, &now);
        let chat = post.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
        self.emit(DaemonEvent::ChatUpdated { chat, reason: None });

        session
            .send_message(
                outgoing_content,
                processed.images.clone(),
                message_uuid.clone(),
            )
            .await?;

        if let Some(uuid) = message_uuid {
            let r = QueuedMessageRef {
                message_id: message.id.clone(),
                chat_id: chat_id.to_string(),
                uuid: uuid.clone(),
                content: content.to_string(),
                attachment_ids: attachment_ids.filter(|a| !a.is_empty()).map(|a| a.to_vec()),
                timestamp: message.timestamp.clone(),
            };
            self.queued_refs
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(uuid.clone(), r.clone());
            self.emit(DaemonEvent::MessageQueued {
                chat_id: chat_id.to_string(),
                r#ref: r,
            });
            info!(
                chat_id,
                uuid,
                message_id = message.id,
                "message sent to CLI while busy (queued)"
            );
        }
        Ok(())
    }

    fn set_working(&self, cell: &Arc<Mutex<ActiveChat>>, chat_id: &str, now: &str) {
        {
            let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            guard.chat.process_state = Some(Some(ProcessState::Working));
            guard.chat.updated_at = now.to_string();
        }
        self.deps.chats_update(
            chat_id,
            &ChatUpdate {
                process_state: Some(Some(ProcessState::Working)),
                updated_at: Some(now.to_string()),
                ..Default::default()
            },
        );
    }

    pub async fn edit_queued_message(
        &self,
        chat_id: &str,
        message_id: &str,
        content: &str,
    ) -> Result<(), SendError> {
        let r = self.find_ref(chat_id, message_id);
        let Some(r) = r else {
            return Ok(());
        };
        let Some(session) = self.get_session_for_chat(chat_id) else {
            return Ok(());
        };

        let cancelled = session.cancel_queued_message(r.uuid.clone()).await?;
        if !cancelled {
            info!(
                chat_id,
                uuid = r.uuid,
                "edit lost race: original already dequeued by CLI"
            );
            return Ok(());
        }

        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&r.uuid);
        self.emit(DaemonEvent::MessageQueuedCancelled {
            chat_id: chat_id.to_string(),
            uuid: r.uuid.clone(),
        });
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove_by_id(chat_id, &r.message_id);
        self.event_handler.emit_display(chat_id);

        self.send_message(chat_id, content, r.attachment_ids.as_deref(), None)
            .await
    }

    pub async fn cancel_queued_message(
        &self,
        chat_id: &str,
        message_id: &str,
    ) -> Result<(), SendError> {
        let r = self.find_ref(chat_id, message_id);
        let Some(r) = r else {
            return Ok(());
        };
        let Some(session) = self.get_session_for_chat(chat_id) else {
            return Ok(());
        };

        let cancelled = session.cancel_queued_message(r.uuid.clone()).await?;
        if !cancelled {
            info!(
                chat_id,
                uuid = r.uuid,
                "cancel lost race: message already dequeued by CLI"
            );
            return Ok(());
        }

        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&r.uuid);
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove_by_id(chat_id, &r.message_id);
        self.emit(DaemonEvent::MessageQueuedCancelled {
            chat_id: chat_id.to_string(),
            uuid: r.uuid.clone(),
        });
        self.event_handler.emit_display(chat_id);
        info!(chat_id, uuid = r.uuid, "queued message cancelled in CLI");
        Ok(())
    }

    fn find_ref(&self, chat_id: &str, message_id: &str) -> Option<QueuedMessageRef> {
        self.queued_refs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .find(|r| r.chat_id == chat_id && r.message_id == message_id)
            .cloned()
    }
}

/// `metadata.command` for `sendMessage` (`{ name, source, args? }`).
#[derive(Debug, Clone)]
pub struct CommandMeta {
    pub name: String,
    pub source: String,
    pub args: Option<String>,
}

/// Error surfaced by `sendMessage`/queue ops (message crosses the wire).
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct SendError(pub String);

impl From<AdapterError> for SendError {
    fn from(e: AdapterError) -> Self {
        SendError(e.to_string())
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests;

// PORT STATUS: src/chat/chat-manager.ts (787 lines)
// confidence: medium
// notes: The TS closure-over-`this` wiring → concrete delegating Deps wrappers
// notes: (EhDeps/LcDeps/PhDeps) that share ONE `Arc<dyn ChatManagerDeps>` + the
// notes: shared PER_ENTITY caches (`Arc<Mutex<MessageCache/PermissionManager>>`,
// notes: `Arc<DashMap<_, Arc<Mutex<ActiveChat>>>>`, `Arc<Mutex<HashMap<uuid,ref>>>`).
// notes: `emitEvent`'s enrich-on-emit (displayStatus/isRunning/worktreeMissing) is a
// notes: shared `enrich_and_emit` the wrappers + facade both call; `deps.emit_event`
// notes: is the RAW onEvent. sendMessage + CLI-owned queue (edit/cancel/handleQueued/
// notes: clearAll) + command routing (wrap_mainframe_command / send_command) ported
// notes: 1:1; queuedRefs keyed by uuid, filtered by chatId (per CONCURRENCY.tsv 72).
// notes: TODO(port): plan-mode delegation (PhDeps) + getPendingPermission's history
// notes: restore are no-op seams pending the adapter createPlanModeHandler + the
// notes: getMessages history loader (server-integration phase); config_manager /
// notes: external-session / worktree-config facade methods are wired in that phase
// notes: (their sub-managers already ported in 4.5a). Ported tests: chat-manager-
// notes: cli-queue (5), chat-manager-recover-working (5), chat-manager-turn-timing
// notes: (1), command-routing routing cases (7), remove-project-kills-tasks (1).
// todos: 4
