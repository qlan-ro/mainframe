//! Ports the chat-manager `__tests__` (cli-queue, recover-working, turn-timing,
//! command-routing, remove-project-kills-tasks) assertion-for-assertion.

use super::*;
use crate::test_support::test_chat;
use mainframe_adapter_api::{
    ContextFiles, ImageInput, PlanModeActionHandler, SessionSink, StopBackgroundTaskResult,
};
use mainframe_types::adapter::{AdapterProcess, ControlResponse, SessionSpawnOptions};
use mainframe_types::background_task::BackgroundTask;
use mainframe_types::chat::{Chat, ChatStatus, ProcessState};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::settings::ExecutionMode;
use std::sync::atomic::{AtomicUsize, Ordering};

mod chat_surface_wiring;
mod fork_chat;
mod fork_from_message;
mod fork_history;
mod fork_segments;
mod fork_sweep;
mod fork_title;
mod history_eviction;
mod history_snapshot;
mod offload;
mod orchestration;
mod plan_mode;
mod provider_switch;
mod resume_overlay;
mod resume_snapshot;
mod segment_fake;
mod side_chat;

// ── fake ChatManagerDeps ─────────────────────────────────────────────────────

#[derive(Default)]
pub(crate) struct StoreDeps {
    store: Mutex<HashMap<String, Chat>>,
    events: Mutex<Vec<DaemonEvent>>,
    updates: Mutex<Vec<(String, ChatUpdate)>>,
    order: Arc<Mutex<Vec<String>>>,
    project_removed: Mutex<Vec<String>>,
    mentions: Mutex<Vec<(String, String)>>,
    /// `adapter.isTranscriptPresent` result (None = cannot determine).
    transcript_present: Mutex<Option<bool>>,
    /// When `Some`, `create_session` yields a session whose `load_history` returns it.
    history: Mutex<Option<Vec<ChatMessage>>>,
    /// Counts `load_history` across every session this fake hands out.
    history_loads: Arc<AtomicUsize>,
    /// Every `SessionOptions` `create_session` was called with, in order — lets
    /// a test assert the resume anchor (`chat_id`) and `session_file_path`
    /// actually threaded into a post-offload respawn (AC7).
    created_sessions: Mutex<Vec<mainframe_types::adapter::SessionOptions>>,
    /// What every `FakeSession` this hands out sets `spawn_ok` to (AC7 needs a
    /// real spawn success to observe the post-resume send).
    spawn_ok: Mutex<bool>,
    /// Records every path `trust_workspace` persisted, for assertion.
    trusted_paths: Mutex<Vec<String>>,
    /// When `Some`, `write_workspace_trust` fails with this message instead of
    /// recording the call.
    fail_trust_write: Mutex<Option<String>>,
    /// When `Some`, `projects_remove` records the id and then fails with this message.
    fail_project_remove: Mutex<Option<String>>,
    /// What `generate_title` returns.
    generated_title: Mutex<Option<String>>,
    /// The `content` of every `generate_title` call, in order.
    generate_title_calls: Mutex<Vec<String>>,
    /// When set, `generate_title` awaits `notified()` on it before returning.
    title_gate: Mutex<Option<Arc<tokio::sync::Notify>>>,
    /// When set, `process_attachments` returns a clone of it; `None` keeps
    /// today's `ProcessedAttachments::default()`.
    attachments: Mutex<Option<ProcessedAttachments>>,
    /// What `extract_mentions_from_text` returns.
    mentions_found: Mutex<bool>,
    /// What `create_plan_mode_handler` returns, so plan-mode dispatcher tests
    /// can inject a recorder (or leave `None` for the unresolved-handler path).
    plan_handler: Mutex<Option<Arc<dyn PlanModeActionHandler>>>,
    /// What `adapter_supports_no_persistence` answers (todo #346, G2b).
    no_persistence_capability: Mutex<bool>,
    /// Every `ensure_dir` path, in order.
    ensure_dir_calls: Mutex<Vec<String>>,
    /// Every `mark_context_lost(chat_id, context_lost_at)` call, in order.
    mark_context_lost_calls: Mutex<Vec<(String, String)>>,
    /// Every `remove_scratch_dir` path, in order (todo #346).
    remove_scratch_dir_calls: Mutex<Vec<String>>,
    /// When `Some`, `remove_scratch_dir` fails with this message instead of
    /// recording success. Cleared by the test between a failing call and a
    /// retry, so `discard_chat` can be proven retryable (todo #346).
    fail_remove_scratch_dir: Mutex<Option<String>>,
    /// `adapter_fork_info(adapter_id).fork` — todo #343's fork_chat tests flip
    /// this on; every other test leaves the trait default (`false`).
    fork_capable: Mutex<bool>,
    /// `adapter_fork_info(adapter_id).unavailable_reason` — todo #368's
    /// version-gate tests set this to prove the reason wins over the generic
    /// `Unsupported` message; every other test leaves it `None`.
    fork_unavailable_reason: Mutex<Option<String>>,
    /// When `Some`, `pin_fork_point` fails with this instead of echoing the
    /// source session id back as the snapshot path.
    pin_failure: Mutex<Option<PinFailure>>,
    /// Every `pin_fork_point` request, in order — the from-message tests
    /// assert the cut the chat layer resolved.
    pin_requests: Mutex<Vec<ForkPinRequest>>,
    /// When `Some`, `create_fork` fails with this message instead of inserting.
    create_fork_failure: Mutex<Option<String>>,
    /// Every `create_fork` input, so tests can assert the copied segments.
    fork_inserts: Mutex<Vec<ForkCreateInput>>,
    /// `db.chats.pendingFork` per chat id, for the lifecycle/history/title tests
    /// that resume an unsent fork.
    pending_forks: Mutex<HashMap<String, PendingForkState>>,
    /// `fork_snapshots_dir()` override, for the startup-sweep tests (a real
    /// tempdir the sweep can list and remove from).
    fork_snapshots_dir: Mutex<Option<String>>,
    /// `AdapterSession::history_sources()` for every `FakeSession` this hands
    /// out — empty by default (the trait's own "do not cache" default), so
    /// only the history-cache integration test that sets real, stat-able
    /// paths here ever exercises it.
    history_sources: Mutex<Vec<std::path::PathBuf>>,
    /// `history_cache_dir()` override, for the same test (a real tempdir it
    /// alone owns, so it can't collide with any other test's chat ids).
    history_cache_dir: Mutex<Option<String>>,
    /// `segment_store()` — set once by the provider-switch tests; every other
    /// test leaves it unset (single-segment chats, as before segments existed).
    segment_store: std::sync::OnceLock<Arc<dyn crate::segments::SegmentStore>>,
    /// `adapter_info(adapter_id)` answers, keyed by adapter id.
    adapter_infos: Mutex<HashMap<String, mainframe_types::adapter::AdapterInfo>>,
}

/// `pin_fork_point`'s configurable failure, for fork_chat's status-mapping tests.
#[derive(Clone)]
pub(crate) enum PinFailure {
    Unsupported,
    TranscriptMissing,
    Failed(String),
    PointNotFound(String),
}

impl StoreDeps {
    pub(crate) fn arc() -> Arc<Self> {
        Arc::new(Self::default())
    }
    pub(crate) fn with_chats(chats: Vec<Chat>) -> Arc<Self> {
        let d = Self::default();
        {
            let mut s = d.store.lock().unwrap();
            for c in chats {
                s.insert(c.id.clone(), c);
            }
        }
        Arc::new(d)
    }
    pub(crate) fn events(&self) -> Vec<DaemonEvent> {
        self.events.lock().unwrap().clone()
    }
    pub(crate) fn order(&self) -> Vec<String> {
        self.order.lock().unwrap().clone()
    }
    pub(crate) fn created_sessions(&self) -> Vec<mainframe_types::adapter::SessionOptions> {
        self.created_sessions.lock().unwrap().clone()
    }
    pub(crate) fn set_spawn_ok(&self, ok: bool) {
        *self.spawn_ok.lock().unwrap() = ok;
    }
    pub(crate) fn set_fork_capable(&self, fork: bool) {
        *self.fork_capable.lock().unwrap() = fork;
    }
    pub(crate) fn set_fork_unavailable_reason(&self, reason: &str) {
        *self.fork_unavailable_reason.lock().unwrap() = Some(reason.to_string());
    }
    pub(crate) fn fail_pin(&self, message: &str) {
        *self.pin_failure.lock().unwrap() = Some(PinFailure::Failed(message.to_string()));
    }
    pub(crate) fn fail_pin_transcript_missing(&self) {
        *self.pin_failure.lock().unwrap() = Some(PinFailure::TranscriptMissing);
    }
    pub(crate) fn fail_pin_unsupported(&self) {
        *self.pin_failure.lock().unwrap() = Some(PinFailure::Unsupported);
    }
    pub(crate) fn fail_pin_point_not_found(&self, reason: &str) {
        *self.pin_failure.lock().unwrap() = Some(PinFailure::PointNotFound(reason.to_string()));
    }
    pub(crate) fn fork_inserts(&self) -> Vec<ForkCreateInput> {
        self.fork_inserts.lock().unwrap().clone()
    }
    pub(crate) fn pin_requests(&self) -> Vec<ForkPinRequest> {
        self.pin_requests.lock().unwrap().clone()
    }
    pub(crate) fn set_history(&self, history: Vec<ChatMessage>) {
        *self.history.lock().unwrap() = Some(history);
    }
    pub(crate) fn fail_create_fork(&self, message: &str) {
        *self.create_fork_failure.lock().unwrap() = Some(message.to_string());
    }
    pub(crate) fn set_pending_fork(&self, chat_id: &str, pending: PendingForkState) {
        self.pending_forks
            .lock()
            .unwrap()
            .insert(chat_id.to_string(), pending);
    }
    pub(crate) fn chat_count(&self) -> usize {
        self.store.lock().unwrap().len()
    }
    pub(crate) fn set_fork_snapshots_dir(&self, dir: &str) {
        *self.fork_snapshots_dir.lock().unwrap() = Some(dir.to_string());
    }
    pub(crate) fn set_history_sources(&self, sources: Vec<std::path::PathBuf>) {
        *self.history_sources.lock().unwrap() = sources;
    }
    pub(crate) fn set_segment_store(&self, store: Arc<dyn crate::segments::SegmentStore>) {
        let _ = self.segment_store.set(store);
    }
    pub(crate) fn set_adapter_info(&self, info: mainframe_types::adapter::AdapterInfo) {
        self.adapter_infos
            .lock()
            .unwrap()
            .insert(info.id.clone(), info);
    }
    pub(crate) fn set_history_cache_dir(&self, dir: &str) {
        *self.history_cache_dir.lock().unwrap() = Some(dir.to_string());
    }
    /// A snapshot of every stored chat, `sideChatId` NOT yet derived (raw DB
    /// row shape). Callers apply `derive_side_chat_id`/`with_derived_side_chat_ids`.
    fn raw_chats(&self) -> Vec<Chat> {
        self.store.lock().unwrap().values().cloned().collect()
    }
    /// Mirrors the DB's correlated `sideChatId` subquery (todo #344) for this
    /// in-memory double: the id of the (at most one) temporary chat in `all`
    /// whose `parent_chat_id` is `chat_id`.
    fn derive_side_chat_id(chat_id: &str, all: &[Chat]) -> Option<String> {
        all.iter()
            .find(|c| {
                c.temporary && c.parent_chat_id.as_ref().and_then(|p| p.as_deref()) == Some(chat_id)
            })
            .map(|c| c.id.clone())
    }
    fn with_derived_side_chat_ids(&self, mut chats: Vec<Chat>) -> Vec<Chat> {
        let snapshot = chats.clone();
        for c in &mut chats {
            c.side_chat_id = Self::derive_side_chat_id(&c.id, &snapshot);
        }
        chats
    }

    /// A trivial 1:1 echo (one `DisplayMessage` per raw `ChatMessage`,
    /// carrying the same id/timestamp/type and its leaf content verbatim,
    /// `Node` content dropped) — real conversion (grouping, tag stripping)
    /// lives outside this crate's dep set. Carrying the type and leaf
    /// content through (todo #382) is what lets `resume_overlay.rs`'s
    /// streaming-attribution assertions (which need an `Assistant` message
    /// whose own last leaf matches the overlay's) exercise the real
    /// projection path, not just COUNT/id-order retention checks. Shared by
    /// `prepare_messages_for_client` (REST) and `display_projector` (the
    /// live/resume path), so both answer identically (todo #376).
    fn convert(raw: &[ChatMessage], _categories: Option<&ToolCategories>) -> Vec<DisplayMessage> {
        raw.iter()
            .map(|m| DisplayMessage {
                id: m.id.clone(),
                chat_id: m.chat_id.clone(),
                r#type: match m.r#type {
                    ChatMessageType::User => mainframe_types::display::DisplayMessageType::User,
                    ChatMessageType::Error => mainframe_types::display::DisplayMessageType::Error,
                    ChatMessageType::Permission => {
                        mainframe_types::display::DisplayMessageType::Permission
                    }
                    ChatMessageType::System => mainframe_types::display::DisplayMessageType::System,
                    _ => mainframe_types::display::DisplayMessageType::Assistant,
                },
                content: m
                    .content
                    .iter()
                    .filter_map(|c| match c {
                        MessageContent::Leaf(leaf) => {
                            Some(mainframe_types::display::DisplayContent::Leaf(leaf.clone()))
                        }
                        MessageContent::Node(_) => None,
                    })
                    .collect(),
                timestamp: m.timestamp.clone(),
                metadata: None,
            })
            .collect()
    }
}

impl ChatManagerDeps for StoreDeps {
    fn emit_event(&self, event: DaemonEvent) {
        self.events.lock().unwrap().push(event);
    }
    fn get_tool_categories(&self, _chat_id: &str) -> Option<ToolCategories> {
        None
    }
    /// A trivial 1:1 echo (one `DisplayMessage` per raw `ChatMessage`,
    /// carrying the same id/timestamp/type and its leaf content verbatim,
    /// `Node` content dropped) — real conversion (grouping, tag stripping)
    /// lives outside this crate's dep set. Carrying the type and leaf
    /// content through (todo #382) is what lets `resume_overlay.rs`'s
    /// streaming-attribution assertions (which need an `Assistant` message
    /// whose own last leaf matches the overlay's) exercise the real
    /// `project_display` path, not just COUNT/id-order retention checks.
    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        Self::convert(raw, categories)
    }
    /// Wraps the same 1:1 echo in a `FullRebuildProjector` (todo #376): the
    /// closure appends the overlay itself before converting, reproducing
    /// what the deleted `project_display` free function used to do for
    /// every `EventHandlerDeps`/`ChatManagerDeps` caller.
    fn display_projector(&self) -> Box<dyn mainframe_display::DisplayProjector> {
        Box::new(mainframe_display::FullRebuildProjector::new(
            |raw, overlay, categories| {
                let combined: Vec<ChatMessage> = match overlay {
                    Some(o) => raw
                        .iter()
                        .cloned()
                        .chain(std::iter::once(o.clone()))
                        .collect(),
                    None => raw.to_vec(),
                };
                StoreDeps::convert(&combined, categories)
            },
        ))
    }
    fn strip_command_tags(&self, text: &str) -> String {
        text.to_string()
    }
    fn chats_get(&self, id: &str) -> Option<Chat> {
        let all = self.raw_chats();
        let mut chat = all.iter().find(|c| c.id == id)?.clone();
        chat.side_chat_id = Self::derive_side_chat_id(id, &all);
        Some(chat)
    }
    fn chats_create(&self, _new_chat: &mainframe_types::chat::NewChat) -> Chat {
        let chat = test_chat("new");
        // Mirrors the real repository (persist, then return): todo #381's
        // offload-of-a-just-created-chat tests need `chats_get("new")` to find
        // it afterward, the same way a real `create_chat` leaves a row behind.
        self.store
            .lock()
            .unwrap()
            .insert(chat.id.clone(), chat.clone());
        chat
    }
    fn chats_delete(&self, chat_id: &str) {
        self.store.lock().unwrap().remove(chat_id);
    }
    fn remove_scratch_dir<'a>(
        &'a self,
        scratch_path: &'a str,
    ) -> BoxFuture<'a, Result<(), String>> {
        self.remove_scratch_dir_calls
            .lock()
            .unwrap()
            .push(scratch_path.to_string());
        let fail = self.fail_remove_scratch_dir.lock().unwrap().clone();
        Box::pin(async move {
            match fail {
                Some(msg) => Err(msg),
                None => Ok(()),
            }
        })
    }
    fn chats_update(&self, chat_id: &str, patch: &ChatUpdate) {
        self.updates
            .lock()
            .unwrap()
            .push((chat_id.to_string(), patch.clone()));
        if let Some(c) = self.store.lock().unwrap().get_mut(chat_id) {
            if let Some(ps) = patch.process_state {
                c.process_state = Some(ps);
            }
            if let Some(tm) = patch.transcript_missing {
                c.transcript_missing = Some(tm);
            }
            if let Some(title) = patch.title.clone() {
                c.title = Some(title);
            }
            if let Some(vse) = patch.vendor_session_ephemeral {
                c.vendor_session_ephemeral = vse;
            }
            // todo #381's config-after-offload tests assert the model/worktree
            // binding actually persisted to the store, not just the live cell.
            if let Some(model) = patch.model.clone() {
                c.model = Some(model);
            }
            if let Some(worktree_path) = patch.worktree_path.clone() {
                c.worktree_path = worktree_path;
            }
            if let Some(branch_name) = patch.branch_name.clone() {
                c.branch_name = branch_name;
            }
        }
    }
    fn chats_list(&self, _project_id: &str) -> Vec<Chat> {
        self.with_derived_side_chat_ids(self.raw_chats())
    }
    fn chats_list_all(&self) -> Vec<Chat> {
        self.with_derived_side_chat_ids(self.raw_chats())
    }
    fn chats_list_filtered(
        &self,
        _project_id: Option<&str>,
        _tags_all: Option<&[String]>,
        _has_worktree: bool,
        _include_archived: bool,
        _include_temporary: bool,
    ) -> Vec<Chat> {
        self.with_derived_side_chat_ids(self.raw_chats())
    }
    fn chats_add_mention(&self, chat_id: &str, mention: &mainframe_types::context::SessionMention) {
        self.mentions
            .lock()
            .unwrap()
            .push((chat_id.to_string(), mention.name.clone()));
    }
    fn chats_reset_working_to_idle(&self) -> i64 {
        let mut count = 0;
        let mut s = self.store.lock().unwrap();
        for c in s.values_mut() {
            if c.process_state == Some(Some(ProcessState::Working)) {
                c.process_state = Some(Some(ProcessState::Idle));
                count += 1;
            }
        }
        count
    }
    fn projects_get_path(&self, _project_id: &str) -> Option<String> {
        Some("/tmp/test".to_string())
    }
    fn projects_remove(&self, project_id: &str) -> Result<(), String> {
        self.project_removed
            .lock()
            .unwrap()
            .push(project_id.to_string());
        match self.fail_project_remove.lock().unwrap().clone() {
            Some(msg) => Err(msg),
            None => Ok(()),
        }
    }
    fn write_workspace_trust<'a>(
        &'a self,
        project_path: &'a str,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            if let Some(msg) = self.fail_trust_write.lock().unwrap().clone() {
                return Err(msg);
            }
            self.trusted_paths
                .lock()
                .unwrap()
                .push(project_path.to_string());
            Ok(())
        })
    }
    fn settings_get(&self, _ns: &str, _key: &str) -> Option<String> {
        None
    }
    fn add_plan_file(&self, _chat_id: &str, _file_path: &str) -> bool {
        false
    }
    fn add_skill_file(&self, _chat_id: &str, _entry: &SkillFileEntry) -> bool {
        false
    }
    fn update_todos(&self, _chat_id: &str, _todos: &[mainframe_types::chat::TodoItem]) {}
    fn add_detected_prs(
        &self,
        _chat_id: &str,
        _prs: &[mainframe_types::adapter::DetectedPr],
    ) -> Vec<mainframe_types::adapter::DetectedPr> {
        Vec::new()
    }
    fn create_session(
        &self,
        _adapter_id: &str,
        options: mainframe_types::adapter::SessionOptions,
    ) -> Option<Arc<dyn AdapterSession>> {
        self.created_sessions.lock().unwrap().push(options);
        self.history.lock().unwrap().clone().map(|history| {
            Arc::new(crate::test_support::FakeSession {
                history,
                history_loads: Some(Arc::clone(&self.history_loads)),
                history_sources: self.history_sources.lock().unwrap().clone(),
                spawn_ok: *self.spawn_ok.lock().unwrap(),
                ..Default::default()
            }) as Arc<dyn AdapterSession>
        })
    }
    fn create_plan_mode_handler(
        &self,
        _adapter_id: &str,
    ) -> Option<Arc<dyn PlanModeActionHandler>> {
        self.plan_handler.lock().unwrap().clone()
    }

    fn attachment_delete_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn process_attachments<'a>(
        &'a self,
        _chat_id: &'a str,
        _attachment_ids: &'a [String],
    ) -> BoxFuture<'a, ProcessedAttachments> {
        let p = self.attachments.lock().unwrap().clone().unwrap_or_default();
        Box::pin(async move { p })
    }
    fn kill_tasks_for_chat<'a>(
        &'a self,
        chat_id: &'a str,
        worktree_path: Option<String>,
        _session: Option<Arc<dyn AdapterSession>>,
    ) -> BoxFuture<'a, ()> {
        self.order.lock().unwrap().push(format!(
            "kill:{chat_id}:{}",
            worktree_path.as_deref().unwrap_or("no-wt")
        ));
        Box::pin(async {})
    }
    fn remove_worktree<'a>(
        &'a self,
        _project_path: &'a str,
        _worktree_path: &'a str,
        _branch_name: &'a str,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn stop_launch_processes<'a>(
        &'a self,
        _project_id: &'a str,
        _effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        None
    }
    fn stop_scope_tunnels<'a>(
        &'a self,
        _project_id: &'a str,
        _effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        None
    }
    fn scan_loaded_history<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn resolve_tuning<'a>(
        &'a self,
        _chat_id: &'a str,
    ) -> BoxFuture<'a, Option<mainframe_types::chat::ResolvedTuning>> {
        Box::pin(async { None })
    }
    fn get_session_context<'a>(
        &'a self,
        _chat_id: &'a str,
        _project_path: &'a str,
        _session: Option<Arc<dyn AdapterSession>>,
        _adapter_id: Option<String>,
    ) -> BoxFuture<'a, mainframe_types::context::SessionContext> {
        Box::pin(async {
            mainframe_types::context::SessionContext {
                global_files: Vec::new(),
                project_files: Vec::new(),
                mentions: Vec::new(),
                attachments: Vec::new(),
                modified_files: Vec::new(),
                skill_files: Vec::new(),
            }
        })
    }
    fn apply_codex_provider_tuning(&self, _session: &Arc<dyn AdapterSession>) {}
    fn generate_title<'a>(
        &'a self,
        _adapter_id: &'a str,
        content: &'a str,
        _binary: &'a str,
    ) -> BoxFuture<'a, Option<String>> {
        self.generate_title_calls
            .lock()
            .unwrap()
            .push(content.to_string());
        let gate = self.title_gate.lock().unwrap().clone();
        let result = self.generated_title.lock().unwrap().clone();
        Box::pin(async move {
            if let Some(gate) = gate {
                gate.notified().await;
            }
            result
        })
    }
    fn is_working_tree_dirty<'a>(&'a self, _project_path: &'a str) -> BoxFuture<'a, bool> {
        Box::pin(async { false })
    }
    fn path_exists(&self, _path: &str) -> bool {
        true
    }
    fn should_notify_permission(&self, _tool_name: Option<&str>) -> bool {
        false
    }
    fn notify_task_complete(&self) -> bool {
        false
    }
    fn notify_session_error(&self) -> bool {
        false
    }
    fn notify_attention_request(&self) -> bool {
        true
    }
    fn extract_mentions_from_text(&self, _chat_id: &str, _text: &str) -> bool {
        *self.mentions_found.lock().unwrap()
    }
    fn tracker_remove_chat(&self, _chat_id: &str) {}
    /// Empty on purpose: mainframe-server's chat_background_activity test covers the wiring (#273).
    fn tracker_list_live(&self, _chat_id: &str) -> Vec<BackgroundTask> {
        Vec::new()
    }
    /// Empty on purpose: chat_deps.rs's tracker_end_all_running_delegates_... test covers the wiring (#273).
    fn tracker_end_all_running(&self, _chat_id: &str) {}
    /// Empty on purpose: chat_deps.rs's workflow_runs_stop_all_delegates_... test covers the wiring.
    fn workflow_runs_stop_all(&self, _chat_id: &str) {}
    /// `transcript_present` = `Some(true)` reports the transcript where the chat
    /// row says it is, so presence tests never also re-point the path.
    fn locate_transcript<'a>(
        &'a self,
        _adapter_id: &'a str,
        session_id: &'a str,
        _project_path: &'a str,
        session_file_path: Option<&'a str>,
    ) -> BoxFuture<'a, Option<mainframe_types::transcript::TranscriptLocation>> {
        use mainframe_types::transcript::TranscriptLocation;
        let present = *self.transcript_present.lock().unwrap();
        let path = session_file_path
            .map(str::to_string)
            .unwrap_or_else(|| format!("/transcripts/{session_id}.jsonl"));
        Box::pin(async move {
            present.map(|present| {
                if present {
                    TranscriptLocation::Present(path)
                } else {
                    TranscriptLocation::Missing
                }
            })
        })
    }
    fn chats_clear_session(&self, chat_id: &str) {
        if let Some(c) = self.store.lock().unwrap().get_mut(chat_id) {
            c.claude_session_id = None;
            c.session_file_path = None;
            c.transcript_missing = Some(false);
        }
    }
    fn chats_clear_worktree(&self, chat_id: &str) {
        if let Some(c) = self.store.lock().unwrap().get_mut(chat_id) {
            c.worktree_path = None;
            c.branch_name = None;
        }
    }
    fn adapter_supports_no_persistence(&self, _adapter_id: &str) -> bool {
        *self.no_persistence_capability.lock().unwrap()
    }
    fn ensure_dir<'a>(&'a self, path: &'a str) -> BoxFuture<'a, ()> {
        self.ensure_dir_calls.lock().unwrap().push(path.to_string());
        Box::pin(async {})
    }
    fn mark_context_lost(&self, chat_id: &str, context_lost_at: &str) {
        self.mark_context_lost_calls
            .lock()
            .unwrap()
            .push((chat_id.to_string(), context_lost_at.to_string()));
        if let Some(c) = self.store.lock().unwrap().get_mut(chat_id) {
            c.context_lost_at = Some(context_lost_at.to_string());
            c.claude_session_id = None;
            c.session_file_path = None;
            c.vendor_session_ephemeral = false;
        }
    }
    fn adapter_fork_info(&self, adapter_id: &str) -> AdapterForkInfo {
        AdapterForkInfo {
            name: adapter_id.to_string(),
            fork: *self.fork_capable.lock().unwrap(),
            unavailable_reason: self.fork_unavailable_reason.lock().unwrap().clone(),
        }
    }
    fn pin_fork_point<'a>(
        &'a self,
        _adapter_id: &'a str,
        request: ForkPinRequest,
    ) -> BoxFuture<'a, Result<ForkSource, ForkPinError>> {
        let failure = self.pin_failure.lock().unwrap().clone();
        self.pin_requests.lock().unwrap().push(request.clone());
        Box::pin(async move {
            match failure {
                Some(PinFailure::Unsupported) => Err(ForkPinError::Unsupported),
                Some(PinFailure::TranscriptMissing) => Err(ForkPinError::TranscriptMissing),
                Some(PinFailure::Failed(message)) => Err(ForkPinError::Failed(message)),
                Some(PinFailure::PointNotFound(reason)) => Err(ForkPinError::PointNotFound(reason)),
                // A cut is echoed as the pinned turn so tests can see it
                // survive into the stored pending fork.
                None => Ok(ForkSource {
                    source_session_id: request.source_session_id,
                    resume_path: Some(format!("{}/snapshot.jsonl", request.dest_dir)),
                    last_turn_id: request.cut.map(|cut| cut.vendor_message_id),
                }),
            }
        })
    }
    fn create_fork(&self, insert: &ForkCreateInput) -> Result<Chat, String> {
        if let Some(message) = self.create_fork_failure.lock().unwrap().clone() {
            return Err(message);
        }
        self.fork_inserts.lock().unwrap().push(insert.clone());
        let id = format!("fork-{}", self.store.lock().unwrap().len());
        let chat = Chat {
            id: id.clone(),
            adapter_id: insert.adapter_id.clone(),
            project_id: insert.project_id.clone(),
            title: insert.title.clone(),
            claude_session_id: None,
            session_file_path: None,
            model: insert.model.clone(),
            permission_mode: insert.permission_mode,
            plan_mode: Some(insert.plan_mode),
            status: ChatStatus::Active,
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            total_cost: 0.0,
            total_tokens_input: 0,
            total_tokens_output: 0,
            last_context_tokens_input: 0,
            last_context_total_tokens: None,
            last_context_max_tokens: None,
            context_files: None,
            mentions: None,
            modified_files: None,
            worktree_path: insert.worktree_path.clone(),
            branch_name: insert.branch_name.clone(),
            process_state: None,
            display_status: None,
            is_running: None,
            background_activity: None,
            worktree_missing: None,
            directory_missing: None,
            missing_directory_path: None,
            transcript_missing: None,
            todos: None,
            pinned: None,
            effort: Some(insert.effort),
            fast: Some(insert.fast),
            ultracode: Some(insert.ultracode),
            adaptive_thinking: Some(insert.adaptive_thinking),
            detected_prs: None,
            tags: None,
            automation_run_id: None,
            temporary: false,
            no_project: false,
            context_lost_at: None,
            vendor_session_ephemeral: false,
            scratch_path: None,
            parent_chat_id: Some(Some(insert.parent_chat_id.clone())),
            side_chat_id: None,
            side_chat_waiting: None,
            orchestration: Default::default(),
        };
        self.store.lock().unwrap().insert(id.clone(), chat.clone());
        self.pending_forks
            .lock()
            .unwrap()
            .insert(id, insert.pending_fork.clone());
        Ok(chat)
    }
    fn get_pending_fork(&self, chat_id: &str) -> Option<PendingForkState> {
        self.pending_forks.lock().unwrap().get(chat_id).cloned()
    }
    fn clear_pending_fork(&self, chat_id: &str) {
        self.pending_forks.lock().unwrap().remove(chat_id);
    }
    fn fork_snapshots_dir(&self) -> String {
        self.fork_snapshots_dir
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| {
                std::env::temp_dir()
                    .join("mainframe-fork-snapshots-test-default")
                    .to_string_lossy()
                    .into_owned()
            })
    }
    fn history_cache_dir(&self) -> String {
        self.history_cache_dir
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| {
                std::env::temp_dir()
                    .join("mainframe-history-cache-test-default")
                    .to_string_lossy()
                    .into_owned()
            })
    }
    fn segment_store(&self) -> Option<&dyn crate::segments::SegmentStore> {
        self.segment_store.get().map(|store| store.as_ref())
    }
    fn adapter_info(&self, adapter_id: &str) -> Option<mainframe_types::adapter::AdapterInfo> {
        self.adapter_infos.lock().unwrap().get(adapter_id).cloned()
    }
    fn chats_find_or_create_side_chat(&self, parent: &Chat) -> Result<(Chat, bool), String> {
        let all = self.raw_chats();
        if let Some(existing_id) = Self::derive_side_chat_id(&parent.id, &all)
            && let Some(existing) = all.iter().find(|c| c.id == existing_id)
        {
            return Ok((existing.clone(), false));
        }
        let id = format!("side-{}", nanoid::nanoid!());
        let now = "2026-01-01T00:00:00.000Z".to_string();
        let side_chat = Chat {
            id: id.clone(),
            adapter_id: parent.adapter_id.clone(),
            project_id: parent.project_id.clone(),
            title: None,
            claude_session_id: None,
            session_file_path: None,
            model: parent.model.clone(),
            permission_mode: parent.permission_mode,
            plan_mode: parent.plan_mode,
            status: ChatStatus::Active,
            created_at: now.clone(),
            updated_at: now,
            total_cost: 0.0,
            total_tokens_input: 0,
            total_tokens_output: 0,
            last_context_tokens_input: 0,
            last_context_total_tokens: None,
            last_context_max_tokens: None,
            context_files: None,
            mentions: None,
            modified_files: None,
            worktree_path: parent.worktree_path.clone(),
            branch_name: parent.branch_name.clone(),
            process_state: None,
            display_status: None,
            is_running: None,
            background_activity: None,
            worktree_missing: None,
            directory_missing: None,
            missing_directory_path: None,
            transcript_missing: None,
            todos: None,
            pinned: None,
            effort: None,
            fast: None,
            ultracode: None,
            adaptive_thinking: None,
            detected_prs: None,
            tags: None,
            automation_run_id: None,
            temporary: true,
            no_project: parent.no_project,
            context_lost_at: None,
            vendor_session_ephemeral: false,
            scratch_path: parent.scratch_path.clone(),
            parent_chat_id: Some(Some(parent.id.clone())),
            side_chat_id: None,
            side_chat_waiting: None,
            orchestration: Default::default(),
        };
        self.store.lock().unwrap().insert(id, side_chat.clone());
        Ok((side_chat, true))
    }
}

// ── recording AdapterSession ─────────────────────────────────────────────────

struct RecSession {
    label: String,
    supports_replay_ack: bool,
    cancel_result: bool,
    send_message_calls: Mutex<Vec<(String, Option<String>)>>,
    send_command_calls: Mutex<Vec<(String, Option<String>)>>,
    cancel_calls: Mutex<Vec<String>>,
    order: Arc<Mutex<Vec<String>>>,
    kills: AtomicUsize,
    /// `images.len()` from every `send_message` call, in order.
    images_calls: Mutex<Vec<usize>>,
    /// Every `respond_to_permission` call, in order — pins the plan-mode escalation
    /// double-send (decision 6).
    responded_calls: Mutex<Vec<ControlResponse>>,
    /// Every `set_permission_mode` call, in order.
    permission_mode_calls: Mutex<Vec<ExecutionMode>>,
    /// Every `steer` call's message, in order. Steering is always supported.
    steer_calls: Mutex<Vec<String>>,
    /// When set, `steer` fails with this message instead of recording the
    /// call (a Codex `turn/steer` rejected because the turn already ended).
    steer_err: Mutex<Option<String>>,
}

impl RecSession {
    fn new(label: &str, supports_replay_ack: bool, cancel_result: bool) -> Arc<Self> {
        Arc::new(Self {
            label: label.to_string(),
            supports_replay_ack,
            cancel_result,
            send_message_calls: Mutex::new(Vec::new()),
            send_command_calls: Mutex::new(Vec::new()),
            cancel_calls: Mutex::new(Vec::new()),
            order: Arc::new(Mutex::new(Vec::new())),
            kills: AtomicUsize::new(0),
            images_calls: Mutex::new(Vec::new()),
            responded_calls: Mutex::new(Vec::new()),
            permission_mode_calls: Mutex::new(Vec::new()),
            steer_calls: Mutex::new(Vec::new()),
            steer_err: Mutex::new(None),
        })
    }
    fn with_order(label: &str, order: Arc<Mutex<Vec<String>>>) -> Arc<Self> {
        Arc::new(Self {
            label: label.to_string(),
            supports_replay_ack: false,
            cancel_result: true,
            send_message_calls: Mutex::new(Vec::new()),
            send_command_calls: Mutex::new(Vec::new()),
            cancel_calls: Mutex::new(Vec::new()),
            order,
            kills: AtomicUsize::new(0),
            images_calls: Mutex::new(Vec::new()),
            responded_calls: Mutex::new(Vec::new()),
            permission_mode_calls: Mutex::new(Vec::new()),
            steer_calls: Mutex::new(Vec::new()),
            steer_err: Mutex::new(None),
        })
    }
}

fn ok<'a>() -> BoxFuture<'a, Result<(), AdapterError>> {
    Box::pin(async { Ok(()) })
}

impl AdapterSession for RecSession {
    fn id(&self) -> &str {
        "sess"
    }
    fn adapter_id(&self) -> &str {
        "mock"
    }
    fn project_path(&self) -> &str {
        "/tmp/test"
    }
    fn is_spawned(&self) -> bool {
        true
    }
    fn supports_replay_ack(&self) -> bool {
        self.supports_replay_ack
    }
    fn spawn(
        &self,
        _options: Option<SessionSpawnOptions>,
        _sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin(async { Err(AdapterError::Message("unused".to_string())) })
    }
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.kills.fetch_add(1, Ordering::SeqCst);
        self.order
            .lock()
            .unwrap()
            .push(format!("sess.kill:{}", self.label));
        ok()
    }
    fn get_process_info(&self) -> Option<AdapterProcess> {
        None
    }
    fn send_message(
        &self,
        message: String,
        images: Vec<ImageInput>,
        uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.images_calls.lock().unwrap().push(images.len());
        self.send_message_calls
            .lock()
            .unwrap()
            .push((message, uuid));
        ok()
    }
    fn supports_steer(&self) -> bool {
        true
    }
    fn steer(
        &self,
        message: String,
        _uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        if let Some(msg) = self.steer_err.lock().unwrap().clone() {
            return Box::pin(async move { Err(AdapterError::Message(msg)) });
        }
        self.steer_calls.lock().unwrap().push(message);
        ok()
    }
    fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.responded_calls.lock().unwrap().push(response);
        ok()
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn set_model(&self, _model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn set_permission_mode(&self, mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.permission_mode_calls.lock().unwrap().push(mode);
        ok()
    }
    fn set_plan_mode(&self, _on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn send_command(
        &self,
        command: String,
        args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.send_command_calls
            .lock()
            .unwrap()
            .push((command, args));
        ok()
    }
    fn cancel_queued_message(&self, uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        self.cancel_calls.lock().unwrap().push(uuid);
        let r = self.cancel_result;
        Box::pin(async move { Ok(r) })
    }
    fn get_context_files(&self) -> ContextFiles {
        ContextFiles::default()
    }
    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn stop_background_task(
        &self,
        _task_id: String,
    ) -> BoxFuture<'_, Result<StopBackgroundTaskResult, AdapterError>> {
        Box::pin(async {
            Ok(StopBackgroundTaskResult {
                ok: false,
                error: Some("unsupported".to_string()),
            })
        })
    }
}

fn seed_active(mgr: &ChatManager, chat_id: &str, chat: Chat, session: Arc<dyn AdapterSession>) {
    mgr.active_chats.insert(
        chat_id.to_string(),
        Arc::new(Mutex::new(ActiveChat::new(chat, Some(session)))),
    );
}

/// Yields long enough for a `tokio::spawn`ed title-generation task to run to
/// completion on the current-thread test runtime.
async fn settle() {
    for _ in 0..50 {
        tokio::task::yield_now().await;
    }
}

/// Every `title` present in `deps.updates` — the store-patch log, not the
/// event stream. Assertions about broadcasts must read `deps.events()` instead.
fn titles_written(deps: &StoreDeps) -> Vec<String> {
    deps.updates
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(_, patch)| patch.title.clone())
        .collect()
}

fn working_chat(id: &str, title: Option<&str>, working: bool) -> Chat {
    let mut c = test_chat(id);
    c.title = title.map(str::to_string);
    c.process_state = Some(Some(if working {
        ProcessState::Working
    } else {
        ProcessState::Idle
    }));
    c
}

// ── chat-manager-cli-queue.test.ts ───────────────────────────────────────────

#[tokio::test]
async fn writes_to_cli_immediately_with_uuid_and_records_queued_ref() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    mgr.send_message("c1", "hello while busy", None, None)
        .await
        .unwrap();

    let calls = session.send_message_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].1.is_some(), "sendMessage carried a uuid");
    drop(calls);
    assert_eq!(mgr.get_queued_for_chat("c1").len(), 1);
}

#[tokio::test]
async fn steer_folds_into_a_working_turn_and_refuses_an_idle_one() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    mgr.steer_message("c1", "also run the tests").await.unwrap();
    assert_eq!(
        *session.steer_calls.lock().unwrap(),
        vec!["also run the tests".to_string()]
    );
    assert!(session.send_message_calls.lock().unwrap().is_empty());

    let idle = RecSession::new("c2", true, true);
    seed_active(
        &mgr,
        "c2",
        working_chat("c2", Some("t"), false),
        idle.clone(),
    );
    assert!(mgr.steer_message("c2", "x").await.is_err());
    assert!(idle.steer_calls.lock().unwrap().is_empty());
}

/// A steer that races the turn's own end (Codex rejects `turn/steer` once the
/// `expectedTurnId` it names has ended, `turn_steer.rs`) must not leave the
/// chat falsely marked Working: nothing else will ever flip it back, since
/// the real turn already finished. Steering never needs to (re)assert
/// Working at all, so the fix is that it never writes `process_state`.
#[tokio::test]
async fn a_steer_that_loses_the_turn_end_race_does_not_relatch_working() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, true);
    *session.steer_err.lock().unwrap() = Some("turn already ended".to_string());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    let err = mgr.steer_message("c1", "also run the tests").await;
    assert!(err.is_err());
    assert!(session.steer_calls.lock().unwrap().is_empty());
    // Steering must never write `process_state`, successful or not: a new
    // turn's `set_working` is the only legitimate source of that patch.
    assert!(
        deps.updates
            .lock()
            .unwrap()
            .iter()
            .all(|(_, patch)| patch.process_state.is_none()),
        "steer must not (re)assert the chat's working state"
    );
    // A failed steer calls the adapter before storing anything: the CLI
    // never received this message, so it must not appear in the
    // transcript as if it had been.
    assert!(
        mgr.get_messages("c1").await.is_empty(),
        "a failed steer must not store a message the CLI never received"
    );
}

/// Review follow-up on 3c86aa74: a steer into a replay-ack adapter (Claude)
/// is also a queued send (`queued_message_metadata`'s `is_queued`), and must
/// go through the same `record_queued_ref`/wait-for-the-ack bookkeeping an
/// ordinary queued `send_message` does — not fire `TurnStarted` itself, or
/// the chat gets that transition twice: once here, once on the replay ack
/// (`on_queued_processed`).
#[tokio::test]
async fn a_queued_steer_records_a_ref_instead_of_restarting_the_turn() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );
    deps.events.lock().unwrap().clear();

    mgr.steer_message("c1", "also run the tests").await.unwrap();

    assert_eq!(
        *session.steer_calls.lock().unwrap(),
        vec!["also run the tests".to_string()]
    );
    assert_eq!(
        mgr.get_queued_for_chat("c1").len(),
        1,
        "a steer the adapter also replay-acks must record a queued ref"
    );
    assert!(
        mgr.get_messages("c1").await.iter().any(|m| {
            m.content.iter().any(|c| {
                matches!(
                    c,
                    mainframe_types::chat::MessageContent::Leaf(
                        mainframe_types::content::LeafContent::Text { text, .. },
                    ) if text.contains("also run the tests")
                )
            })
        }),
        "the steered message is stored, not just queued"
    );
}

#[tokio::test]
async fn handle_queued_processed_deletes_the_ref() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("c1", true, true);
    seed_active(&mgr, "c1", working_chat("c1", Some("t"), true), session);

    mgr.send_message("c1", "hi", None, None).await.unwrap();
    let uuid = mgr.get_queued_for_chat("c1")[0].uuid.clone();
    mgr.handle_queued_processed("c1", &uuid);
    assert_eq!(mgr.get_queued_for_chat("c1").len(), 0);
}

#[tokio::test]
async fn cancel_success_removes_the_bubble_and_emits_cancelled() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    mgr.send_message("c1", "to cancel", None, None)
        .await
        .unwrap();
    let r = mgr.get_queued_for_chat("c1")[0].clone();
    mgr.cancel_queued_message("c1", &r.message_id)
        .await
        .unwrap();

    assert_eq!(
        session.cancel_calls.lock().unwrap().as_slice(),
        std::slice::from_ref(&r.uuid)
    );
    assert_eq!(mgr.get_queued_for_chat("c1").len(), 0);
}

#[tokio::test]
async fn cancel_lost_race_emits_nothing_and_keeps_the_ref() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, false); // CLI already consumed it
    seed_active(&mgr, "c1", working_chat("c1", Some("t"), true), session);

    mgr.send_message("c1", "racey", None, None).await.unwrap();
    let r = mgr.get_queued_for_chat("c1")[0].clone();
    deps.events.lock().unwrap().clear();

    mgr.cancel_queued_message("c1", &r.message_id)
        .await
        .unwrap();

    assert_eq!(mgr.get_queued_for_chat("c1").len(), 1);
    assert_eq!(deps.events().len(), 0);
}

#[tokio::test]
async fn edit_lost_race_silently_discards_the_edit() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, false);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    mgr.send_message("c1", "original", None, None)
        .await
        .unwrap();
    let r = mgr.get_queued_for_chat("c1")[0].clone();
    session.send_message_calls.lock().unwrap().clear();
    deps.events.lock().unwrap().clear();

    mgr.edit_queued_message("c1", &r.message_id, "edited")
        .await
        .unwrap();

    assert!(session.send_message_calls.lock().unwrap().is_empty());
    assert_eq!(deps.events().len(), 0);
    assert_eq!(mgr.get_queued_for_chat("c1").len(), 1);
}

// ── chat-manager-turn-timing.test.ts ─────────────────────────────────────────

#[tokio::test]
async fn stamps_turn_started_at_right_before_dispatching_to_the_cli() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("c1", false, true);
    seed_active(&mgr, "c1", working_chat("c1", Some("t"), false), session);
    let cell = mgr.get_active("c1").unwrap();
    assert!(cell.lock().unwrap().turn_started_at.is_none());

    let before = now_ms();
    mgr.send_message("c1", "hello", None, None).await.unwrap();
    let after = now_ms();

    let ts = cell.lock().unwrap().turn_started_at.unwrap();
    assert!(ts >= before && ts <= after);
}

// ── chat-manager-recover-working.test.ts ─────────────────────────────────────

fn stored(id: &str, ps: Option<Option<ProcessState>>) -> Chat {
    let mut c = test_chat(id);
    c.process_state = ps;
    c
}

#[tokio::test]
async fn resets_a_working_chat_to_idle() {
    let deps = StoreDeps::with_chats(vec![
        stored("c-working", Some(Some(ProcessState::Working))),
        stored("c-idle", Some(Some(ProcessState::Idle))),
        stored("c-null", Some(None)),
    ]);
    let mgr = ChatManager::new(deps.clone());
    mgr.recover_stale_working_state();
    assert_eq!(
        deps.chats_get("c-working").unwrap().process_state,
        Some(Some(ProcessState::Idle))
    );
}

#[tokio::test]
async fn leaves_an_already_idle_chat_unchanged() {
    let deps = StoreDeps::with_chats(vec![
        stored("c-working", Some(Some(ProcessState::Working))),
        stored("c-idle", Some(Some(ProcessState::Idle))),
    ]);
    let mgr = ChatManager::new(deps.clone());
    mgr.recover_stale_working_state();
    assert_eq!(
        deps.chats_get("c-idle").unwrap().process_state,
        Some(Some(ProcessState::Idle))
    );
}

#[tokio::test]
async fn does_not_touch_a_chat_whose_process_state_is_null() {
    let deps = StoreDeps::with_chats(vec![stored("c-null", Some(None))]);
    let mgr = ChatManager::new(deps.clone());
    mgr.recover_stale_working_state();
    assert_eq!(deps.chats_get("c-null").unwrap().process_state, Some(None));
}

#[tokio::test]
async fn is_a_no_op_when_no_chats_are_stored() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps);
    mgr.recover_stale_working_state(); // must not panic
}

#[tokio::test]
async fn resets_every_working_chat_when_multiple_are_stale() {
    let deps = StoreDeps::with_chats(vec![
        stored("w1", Some(Some(ProcessState::Working))),
        stored("w2", Some(Some(ProcessState::Working))),
        stored("ok", Some(Some(ProcessState::Idle))),
    ]);
    let mgr = ChatManager::new(deps.clone());
    mgr.recover_stale_working_state();
    assert_eq!(
        deps.chats_get("w1").unwrap().process_state,
        Some(Some(ProcessState::Idle))
    );
    assert_eq!(
        deps.chats_get("w2").unwrap().process_state,
        Some(Some(ProcessState::Idle))
    );
    assert_eq!(
        deps.chats_get("ok").unwrap().process_state,
        Some(Some(ProcessState::Idle))
    );
}

// ── command-routing.test.ts (ChatManager routing cases) ──────────────────────

fn cmd_chat() -> Chat {
    let mut c = test_chat("chat-1");
    c.title = Some("Test chat".to_string());
    c.process_state = Some(Some(ProcessState::Idle));
    c
}

fn cmd_manager() -> (ChatManager, Arc<RecSession>) {
    let deps = StoreDeps::with_chats(vec![cmd_chat()]);
    let mgr = ChatManager::new(deps);
    let session = RecSession::new("chat-1", false, true);
    seed_active(&mgr, "chat-1", cmd_chat(), session.clone());
    (mgr, session)
}

#[tokio::test]
async fn calls_send_command_when_source_is_a_provider() {
    let (mgr, session) = cmd_manager();
    mgr.send_message(
        "chat-1",
        "/compact",
        None,
        Some(CommandMeta {
            name: "compact".to_string(),
            source: "claude".to_string(),
            args: None,
        }),
    )
    .await
    .unwrap();
    let cmds = session.send_command_calls.lock().unwrap();
    assert_eq!(cmds.len(), 1);
    assert_eq!(cmds[0].0, "compact");
    assert!(session.send_message_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn calls_send_command_with_args_when_provided() {
    let (mgr, session) = cmd_manager();
    mgr.send_message(
        "chat-1",
        "/init --scope project",
        None,
        Some(CommandMeta {
            name: "init".to_string(),
            source: "claude".to_string(),
            args: Some("--scope project".to_string()),
        }),
    )
    .await
    .unwrap();
    let cmds = session.send_command_calls.lock().unwrap();
    assert_eq!(cmds.len(), 1);
    assert_eq!(cmds[0].0, "init");
    assert_eq!(cmds[0].1.as_deref(), Some("--scope project"));
}

#[tokio::test]
async fn calls_send_message_with_wrapped_content_when_source_is_mainframe() {
    let (mgr, session) = cmd_manager();
    mgr.send_message(
        "chat-1",
        "/greet",
        None,
        Some(CommandMeta {
            name: "greet".to_string(),
            source: "mainframe".to_string(),
            args: Some("Say hello".to_string()),
        }),
    )
    .await
    .unwrap();
    let calls = session.send_message_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].0.contains("<mainframe-command name=\"greet\""));
    assert!(calls[0].0.contains("Say hello"));
    assert!(calls[0].0.contains("<mainframe-command-response"));
    assert!(session.send_command_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn updates_process_state_to_working_after_command_routing() {
    let deps = StoreDeps::with_chats(vec![cmd_chat()]);
    let mgr = ChatManager::new(deps.clone());
    seed_active(
        &mgr,
        "chat-1",
        cmd_chat(),
        RecSession::new("chat-1", false, true),
    );
    mgr.send_message(
        "chat-1",
        "/compact",
        None,
        Some(CommandMeta {
            name: "compact".to_string(),
            source: "claude".to_string(),
            args: None,
        }),
    )
    .await
    .unwrap();
    assert!(
        deps.updates
            .lock()
            .unwrap()
            .iter()
            .any(|(id, p)| id == "chat-1" && p.process_state == Some(Some(ProcessState::Working)))
    );
}

#[tokio::test]
async fn calls_plain_send_message_with_raw_content_when_no_metadata() {
    let (mgr, session) = cmd_manager();
    mgr.send_message("chat-1", "Hello world", None, None)
        .await
        .unwrap();
    let calls = session.send_message_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "Hello world");
    assert!(session.send_command_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn sends_unknown_slash_command_as_plain_text() {
    let (mgr, session) = cmd_manager();
    mgr.send_message("chat-1", "/insights", None, None)
        .await
        .unwrap();
    let calls = session.send_message_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "/insights");
    assert!(session.send_command_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn sends_unknown_slash_command_with_args_as_plain_text() {
    let (mgr, session) = cmd_manager();
    mgr.send_message("chat-1", "/branch feature/my-feature", None, None)
        .await
        .unwrap();
    let calls = session.send_message_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "/branch feature/my-feature");
    assert!(session.send_command_calls.lock().unwrap().is_empty());
}

// ── command-first title (#257) ───────────────────────────────────────────────

fn title_cmd_manager(title: Option<&str>) -> (ChatManager, Arc<StoreDeps>, Arc<RecSession>) {
    let mut chat = test_chat("chat-1");
    chat.title = title.map(str::to_string);
    chat.process_state = Some(Some(ProcessState::Idle));
    let deps = StoreDeps::with_chats(vec![chat.clone()]);
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("chat-1", false, true);
    seed_active(&mgr, "chat-1", chat, session.clone());
    (mgr, deps, session)
}

#[tokio::test]
async fn provider_command_first_message_sets_the_fallback_title() {
    let (mgr, deps, session) = title_cmd_manager(None);

    mgr.send_message(
        "chat-1",
        "/compact",
        None,
        Some(CommandMeta {
            name: "compact".to_string(),
            source: "claude".to_string(),
            args: None,
        }),
    )
    .await
    .unwrap();

    let events = deps.events();
    let added = mgr.get_messages("chat-1").await;
    assert_eq!(added.len(), 1, "the user's message is still stored");
    let msg = &added[0];
    assert_eq!(msg.r#type, ChatMessageType::User);
    assert!(
        msg.metadata.is_none(),
        "a command send carries no transient metadata"
    );
    assert!(matches!(
        msg.content.as_slice(),
        [MessageContent::Leaf(LeafContent::Text { text, .. })] if text == "/compact"
    ));

    assert!(
        !events
            .iter()
            .any(|e| matches!(e, DaemonEvent::ContextUpdated { .. })),
        "a command send runs no attachment or mentions check"
    );

    {
        let cmds = session.send_command_calls.lock().unwrap();
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0].0, "compact");
    }
    assert!(session.send_message_calls.lock().unwrap().is_empty());

    assert!(
        deps.updates
            .lock()
            .unwrap()
            .iter()
            .any(|(id, p)| id == "chat-1" && p.process_state == Some(Some(ProcessState::Working))),
        "the chat still transitions to working"
    );

    assert_eq!(
        deps.chats_get("chat-1").unwrap().title,
        Some("/compact".to_string())
    );
    assert!(events.iter().any(
        |e| matches!(e, DaemonEvent::ChatUpdated { chat, .. } if chat.title == Some("/compact".to_string()))
    ));
}

#[tokio::test]
async fn mainframe_command_first_message_titles_from_typed_text_not_the_wrapper() {
    let (mgr, deps, session) = title_cmd_manager(None);

    mgr.send_message(
        "chat-1",
        "/greet Say hello to the team",
        None,
        Some(CommandMeta {
            name: "greet".to_string(),
            source: "mainframe".to_string(),
            args: Some("Say hello".to_string()),
        }),
    )
    .await
    .unwrap();
    settle().await;

    let title = deps.chats_get("chat-1").unwrap().title;
    assert_eq!(title.as_deref(), Some("/greet Say hello to the team"));
    let title = title.unwrap();
    assert!(!title.contains("<mainframe-command"));
    assert!(!title.contains("<mainframe-command-response"));

    let calls = deps.generate_title_calls.lock().unwrap().clone();
    assert_eq!(calls, vec!["/greet Say hello to the team".to_string()]);
    assert!(calls.iter().all(|c| !c.contains("<mainframe-command")));

    let sent = session.send_message_calls.lock().unwrap();
    assert!(sent[0].0.contains("<mainframe-command name=\"greet\""));
}

#[tokio::test]
async fn command_first_message_generated_title_overwrites_the_fallback() {
    let (mgr, deps, _session) = title_cmd_manager(None);
    *deps.generated_title.lock().unwrap() = Some("Compact the session".to_string());

    mgr.send_message(
        "chat-1",
        "/compact",
        None,
        Some(CommandMeta {
            name: "compact".to_string(),
            source: "claude".to_string(),
            args: None,
        }),
    )
    .await
    .unwrap();
    settle().await;

    let mut titles: Vec<Option<String>> = deps
        .events()
        .iter()
        .filter_map(|e| match e {
            DaemonEvent::ChatUpdated { chat, .. } => Some(chat.title.clone()),
            _ => None,
        })
        .collect();
    titles.dedup();
    assert_eq!(
        titles,
        vec![
            Some("/compact".to_string()),
            Some("Compact the session".to_string())
        ]
    );
    assert_eq!(titles.first(), Some(&Some("/compact".to_string())));
    assert_eq!(
        titles.last(),
        Some(&Some("Compact the session".to_string()))
    );
    assert!(!titles.iter().any(|t| t.is_none()));

    assert_eq!(
        titles_written(&deps),
        vec!["/compact".to_string(), "Compact the session".to_string()]
    );
    assert_eq!(
        deps.chats_get("chat-1").unwrap().title,
        Some("Compact the session".to_string())
    );
}

#[tokio::test]
async fn command_into_an_already_titled_chat_leaves_the_title_untouched() {
    let (mgr, deps, _session) = title_cmd_manager(Some("Test chat"));

    mgr.send_message(
        "chat-1",
        "/compact",
        None,
        Some(CommandMeta {
            name: "compact".to_string(),
            source: "claude".to_string(),
            args: None,
        }),
    )
    .await
    .unwrap();
    settle().await;

    assert!(
        !deps
            .updates
            .lock()
            .unwrap()
            .iter()
            .any(|(_, p)| p.title.is_some())
    );
    assert!(deps.events().iter().all(|e| match e {
        DaemonEvent::ChatUpdated { chat, .. } => chat.title.as_deref() == Some("Test chat"),
        _ => true,
    }));
    assert!(deps.generate_title_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn title_generation_is_not_awaited_by_a_command_send() {
    let (mgr, deps, _session) = title_cmd_manager(None);
    *deps.generated_title.lock().unwrap() = Some("Compacted session".to_string());
    let gate = Arc::new(tokio::sync::Notify::new());
    *deps.title_gate.lock().unwrap() = Some(gate.clone());

    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        mgr.send_message(
            "chat-1",
            "/compact",
            None,
            Some(CommandMeta {
                name: "compact".to_string(),
                source: "claude".to_string(),
                args: None,
            }),
        ),
    )
    .await
    .expect("send must not await title generation")
    .unwrap();

    gate.notify_one();
    settle().await;

    assert_eq!(
        deps.chats_get("chat-1").unwrap().title,
        Some("Compacted session".to_string())
    );
}

#[tokio::test]
async fn plain_text_first_message_still_titles_in_the_same_event_order() {
    let (mgr, deps, session) = title_cmd_manager(None);

    mgr.send_message("chat-1", "Hello world", None, None)
        .await
        .unwrap();

    assert_eq!(
        deps.chats_get("chat-1").unwrap().title,
        Some("Hello world".to_string())
    );

    let updated: Vec<Chat> = deps
        .events()
        .into_iter()
        .filter_map(|e| match e {
            DaemonEvent::ChatUpdated { chat, .. } => Some(chat),
            _ => None,
        })
        .collect();
    let title_idx = updated
        .iter()
        .position(|c| c.title.as_deref().is_some_and(|t| !t.is_empty()))
        .expect("a ChatUpdated carried the title");
    let working_idx = updated
        .iter()
        .position(|c| c.process_state == Some(Some(ProcessState::Working)))
        .expect("a ChatUpdated carried Working");
    assert!(title_idx < working_idx);

    assert_eq!(session.send_message_calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn plain_text_first_message_with_a_session_reference_titles_from_the_visible_text() {
    let (mgr, deps, _session) = title_cmd_manager(None);
    let content = "Referenced session @session[Fix login bug]: /tmp/fix-login-bug.jsonl\n\nwhat did they change?";

    mgr.send_message("chat-1", content, None, None)
        .await
        .unwrap();
    settle().await;

    assert_eq!(
        deps.chats_get("chat-1").unwrap().title,
        Some("what did they change?".to_string()),
        "the fallback title must not leak the raw reference preamble"
    );
    assert_eq!(
        deps.generate_title_calls.lock().unwrap().clone(),
        vec!["what did they change?".to_string()],
        "the LLM title call must not see the raw reference preamble either"
    );
}

#[tokio::test]
async fn command_first_fallback_survives_a_generation_that_returns_nothing() {
    let (mgr, deps, _session) = title_cmd_manager(None);

    mgr.send_message(
        "chat-1",
        "/compact",
        None,
        Some(CommandMeta {
            name: "compact".to_string(),
            source: "claude".to_string(),
            args: None,
        }),
    )
    .await
    .unwrap();
    settle().await;

    assert_eq!(
        deps.chats_get("chat-1").unwrap().title,
        Some("/compact".to_string())
    );
    assert_eq!(deps.generate_title_calls.lock().unwrap().len(), 1);
    assert_eq!(titles_written(&deps), vec!["/compact".to_string()]);
}

#[tokio::test]
async fn plain_text_with_attachments_keeps_prefix_images_and_transient_metadata() {
    let deps = StoreDeps::arc();
    *deps.attachments.lock().unwrap() = Some(ProcessedAttachments {
        images: vec![ImageInput {
            media_type: "image/png".to_string(),
            data: "AAA".to_string(),
            path: None,
        }],
        message_content: vec![MessageContent::Leaf(LeafContent::Text {
            text: "[Image: shot.png]".to_string(),
            parent_tool_use_id: None,
        })],
        text_prefix: vec!["prefix".to_string()],
        attachment_previews: vec![serde_json::json!({ "id": "att-1" })],
    });
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    let ids = vec!["att-1".to_string()];
    mgr.send_message("c1", "hello", Some(&ids), None)
        .await
        .unwrap();

    let sent_uuid = {
        let calls = session.send_message_calls.lock().unwrap();
        assert_eq!(calls[0].0, "prefix\n\nhello");
        calls[0].1.clone()
    };
    assert_eq!(session.images_calls.lock().unwrap()[0], 1);

    let added = mgr.get_messages("c1").await;
    assert_eq!(added.len(), 1);
    let msg = &added[0];
    let texts: Vec<&str> = msg
        .content
        .iter()
        .map(|c| match c {
            MessageContent::Leaf(LeafContent::Text { text, .. }) => text.as_str(),
            other => panic!("expected text content, got {other:?}"),
        })
        .collect();
    assert_eq!(texts, vec!["[Image: shot.png]", "hello"]);

    let metadata = msg
        .metadata
        .as_ref()
        .expect("queued message carries transient metadata");
    assert_eq!(metadata.get("queued"), Some(&serde_json::json!(true)));
    assert_eq!(
        metadata.get("attachments"),
        Some(&serde_json::json!([{ "id": "att-1" }]))
    );
    assert_eq!(
        metadata
            .get("uuid")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        sent_uuid
    );

    let context_updates = deps
        .events()
        .iter()
        .filter(|e| matches!(e, DaemonEvent::ContextUpdated { .. }))
        .count();
    assert_eq!(context_updates, 1);
}

#[tokio::test]
async fn mentions_in_plain_text_still_emit_context_updated() {
    let deps = StoreDeps::arc();
    *deps.mentions_found.lock().unwrap() = true;
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", false, true);
    seed_active(&mgr, "c1", working_chat("c1", Some("t"), false), session);

    mgr.send_message("c1", "look at @src/main.rs", None, None)
        .await
        .unwrap();

    let context_updates = deps
        .events()
        .iter()
        .filter(|e| matches!(e, DaemonEvent::ContextUpdated { .. }))
        .count();
    assert_eq!(context_updates, 1);
}

// ── remove-project-kills-tasks.test.ts ───────────────────────────────────────

#[tokio::test]
async fn calls_kill_tasks_before_session_kill_for_each_chat() {
    let mut c1 = test_chat("c1");
    c1.project_id = "p1".to_string();
    c1.worktree_path = Some("/wt/c1".to_string());
    let mut c2 = test_chat("c2");
    c2.project_id = "p1".to_string();
    c2.worktree_path = None;

    let deps = StoreDeps::with_chats(vec![c1.clone(), c2.clone()]);
    let order = deps.order.clone();
    let mgr = ChatManager::new(deps.clone());

    let s1 = RecSession::with_order("c1", order.clone());
    let s2 = RecSession::with_order("c2", order.clone());
    seed_active(&mgr, "c1", c1, s1);
    seed_active(&mgr, "c2", c2, s2);

    assert!(mgr.remove_project("p1").await.is_ok());

    let order = order.lock().unwrap();
    let idx = |s: &str| order.iter().position(|x| x == s);
    assert!(idx("kill:c1:/wt/c1").unwrap() < idx("sess.kill:c1").unwrap());
    assert!(idx("kill:c2:no-wt").unwrap() < idx("sess.kill:c2").unwrap());
    assert_eq!(
        deps.project_removed.lock().unwrap().as_slice(),
        &["p1".to_string()]
    );
}

#[tokio::test]
async fn remove_project_propagates_a_row_delete_failure() {
    let mut c1 = test_chat("c1");
    c1.project_id = "p1".to_string();
    c1.worktree_path = Some("/wt/c1".to_string());

    let deps = StoreDeps::with_chats(vec![c1.clone()]);
    let order = deps.order.clone();
    *deps.fail_project_remove.lock().unwrap() = Some("database is locked".to_string());
    let mgr = ChatManager::new(deps.clone());

    let s1 = RecSession::with_order("c1", order.clone());
    seed_active(&mgr, "c1", c1, s1);

    let result = mgr.remove_project("p1").await;
    assert_eq!(result, Err("database is locked".to_string()));

    let order = order.lock().unwrap();
    let idx = |s: &str| order.iter().position(|x| x == s);
    assert!(idx("kill:c1:/wt/c1").unwrap() < idx("sess.kill:c1").unwrap());
    assert_eq!(
        deps.project_removed.lock().unwrap().as_slice(),
        &["p1".to_string()]
    );
}

// ── discard_chat (todo #346, rule 5) ─────────────────────────────────────────

#[tokio::test]
async fn discard_chat_stops_the_process_deletes_the_row_and_removes_the_scratch_dir() {
    let mut c1 = test_chat("c1");
    c1.temporary = true;
    c1.scratch_path = Some("/tmp/mf-scratch/c1".to_string());

    let deps = StoreDeps::with_chats(vec![c1.clone()]);
    let mgr = ChatManager::new(deps.clone());
    let session = RecSession::new("c1", false, true);
    seed_active(&mgr, "c1", c1, session.clone());

    assert!(mgr.discard_chat("c1").await.is_ok());

    assert_eq!(
        session.kills.load(Ordering::SeqCst),
        1,
        "the process must be stopped"
    );
    assert!(
        mgr.get_active("c1").is_none(),
        "the active-chat entry must be dropped"
    );
    assert_eq!(
        deps.remove_scratch_dir_calls.lock().unwrap().as_slice(),
        &["/tmp/mf-scratch/c1".to_string()]
    );
    assert!(
        deps.chats_get("c1").is_none(),
        "the row must be deleted (a subsequent GET 404s)"
    );
}

#[tokio::test]
async fn discard_chat_forgets_a_pending_worktree_offer_and_queued_ref() {
    let mut chat = test_chat("c1");
    chat.temporary = true;
    let deps = StoreDeps::with_chats(vec![chat.clone()]);
    let mgr = ChatManager::new(deps);
    seed_active(&mgr, "c1", chat, RecSession::new("c1", false, true));
    mgr.worktree_offers.seed_pending_for_test("c1", "/tmp/wt");
    mgr.worktree_offers
        .seed_pending_for_test("c2", "/tmp/other");
    mgr.queued_refs.lock().unwrap().push(QueuedMessageRef {
        message_id: "m1".to_string(),
        chat_id: "c1".to_string(),
        uuid: "u1".to_string(),
        content: "queued".to_string(),
        attachment_ids: None,
        timestamp: String::new(),
    });
    assert_eq!(mgr.worktree_offers_for_chat("c1").len(), 1);

    mgr.discard_chat("c1").await.unwrap();

    assert!(mgr.worktree_offers_for_chat("c1").is_empty());
    assert_eq!(mgr.worktree_offers_for_chat("c2").len(), 1);
    assert!(mgr.get_queued_for_chat("c1").is_empty());
    assert!(mgr.get_active("c1").is_none());
}

#[tokio::test]
async fn archive_and_end_keep_their_message_cache_contracts_and_forget_offers() {
    for end in [false, true] {
        let deps = StoreDeps::with_chats(vec![test_chat("c1")]);
        let mgr = ChatManager::new(deps);
        seed_active(
            &mgr,
            "c1",
            test_chat("c1"),
            RecSession::new("c1", false, true),
        );
        mgr.messages.lock().unwrap().set("c1", Vec::new());
        mgr.worktree_offers.seed_pending_for_test("c1", "/tmp/wt");
        mgr.queued_refs.lock().unwrap().push(QueuedMessageRef {
            message_id: "m1".to_string(),
            chat_id: "c1".to_string(),
            uuid: "u1".to_string(),
            content: "queued".to_string(),
            attachment_ids: None,
            timestamp: String::new(),
        });

        if end {
            mgr.end_chat("c1").await;
        } else {
            mgr.archive_chat("c1", false).await;
        }

        assert!(mgr.get_active("c1").is_none());
        assert!(mgr.worktree_offers_for_chat("c1").is_empty());
        assert!(mgr.get_queued_for_chat("c1").is_empty());
        assert_eq!(mgr.messages.lock().unwrap().get("c1").is_some(), end);
    }
}

#[tokio::test]
async fn discard_chat_whose_scratch_dir_removal_fails_leaves_the_chat_discardable() {
    let mut c1 = test_chat("c1");
    c1.temporary = true;
    c1.scratch_path = Some("/tmp/mf-scratch/c1".to_string());

    let deps = StoreDeps::with_chats(vec![c1.clone()]);
    *deps.fail_remove_scratch_dir.lock().unwrap() = Some("permission denied".to_string());
    let mgr = ChatManager::new(deps.clone());

    let result = mgr.discard_chat("c1").await;
    assert_eq!(result, Err("permission denied".to_string()));
    assert!(
        deps.chats_get("c1").is_some(),
        "a failed removal must leave the row (and a retry) intact"
    );

    // Retry, this time the removal succeeds.
    *deps.fail_remove_scratch_dir.lock().unwrap() = None;
    assert!(mgr.discard_chat("c1").await.is_ok());
    assert!(deps.chats_get("c1").is_none());
}

#[tokio::test]
async fn discard_chat_404s_for_an_unknown_chat() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps);
    assert_eq!(
        mgr.discard_chat("missing").await,
        Err("Chat not found".to_string())
    );
}

// ── Task 5.4 facade methods ──────────────────────────────────────────────────

use mainframe_types::adapter::EffortLevel;
use mainframe_types::context::{MentionKind, MentionSource, SessionMention};

#[tokio::test]
async fn sync_chat_fields_mirrors_tuning_onto_the_cached_active_chat() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), false),
        RecSession::new("c1", false, true),
    );

    mgr.sync_chat_fields(
        "c1",
        ChatFieldsPartial {
            effort: Some(Some(EffortLevel::High)),
            fast: Some(Some(true)),
            pinned: Some(true),
            ..Default::default()
        },
    );

    let chat = mgr.get_active("c1").unwrap().lock().unwrap().chat.clone();
    assert_eq!(chat.effort, Some(Some(EffortLevel::High)));
    assert_eq!(chat.fast, Some(Some(true)));
    assert_eq!(chat.pinned, Some(true));
    // Untouched fields stay unchanged.
    assert_eq!(chat.ultracode, test_chat("c1").ultracode);
}

#[tokio::test]
async fn notify_worktree_deleted_emits_only_for_matching_worktree() {
    let mut with_wt = test_chat("c1");
    with_wt.worktree_path = Some("/wt/x".to_string());
    let without = test_chat("c2");
    let deps = StoreDeps::with_chats(vec![with_wt, without]);
    let mgr = ChatManager::new(deps.clone());

    mgr.notify_worktree_deleted("/wt/x");

    let updated: Vec<String> = deps
        .events()
        .into_iter()
        .filter_map(|e| match e {
            DaemonEvent::ChatUpdated { chat, .. } => Some(chat.id),
            _ => None,
        })
        .collect();
    assert_eq!(updated, vec!["c1".to_string()]);
}

#[tokio::test]
async fn add_mention_persists_and_emits_context_updated() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());

    mgr.add_mention(
        "c1",
        SessionMention {
            id: "m1".to_string(),
            kind: MentionKind::File,
            source: MentionSource::User,
            name: "foo.rs".to_string(),
            path: Some("src/foo.rs".to_string()),
            timestamp: "2026-07-10T00:00:00.000Z".to_string(),
        },
    );

    assert_eq!(
        deps.mentions.lock().unwrap().as_slice(),
        &[("c1".to_string(), "foo.rs".to_string())]
    );
    assert!(
        deps.events()
            .iter()
            .any(|e| matches!(e, DaemonEvent::ContextUpdated { chat_id, .. } if chat_id == "c1"))
    );
}

#[tokio::test]
async fn get_effective_path_falls_back_to_the_project_root() {
    let deps = StoreDeps::with_chats(vec![test_chat("c1")]);
    let mgr = ChatManager::new(deps);
    // test_chat has no worktree → project root from projects_get_path.
    assert_eq!(mgr.get_effective_path("c1").as_deref(), Some("/tmp/test"));
    assert_eq!(mgr.get_effective_path("missing"), None);
}

#[tokio::test]
async fn get_messages_is_empty_without_a_claude_session() {
    let deps = StoreDeps::with_chats(vec![test_chat("c1")]);
    let mgr = ChatManager::new(deps);
    assert!(mgr.get_messages("c1").await.is_empty());
}

// Keep ChatStatus referenced (used by test_chat defaults).
#[allow(dead_code)]
fn _status() -> ChatStatus {
    ChatStatus::Active
}

// ── chat-manager-background-activity.test.ts (enrichChat derivation) ──────────
// The TS test drives `manager.getChat` with a fake-timed tracker; the Rust port's
// backgroundActivity derivation lives in the private `enrich_chat`, tested here
// directly with fixed `startedAt` (Rust can't trivially freeze the clock).
mod background_activity {
    use super::*;
    use crate::chat_manager::shared::enrich_chat;
    use mainframe_types::background_task::{
        BackgroundActivity, BackgroundActivityTask, BackgroundTask, BackgroundTaskStatus,
        BackgroundTaskToolName, BackgroundWorkKind,
    };
    use mainframe_types::chat::DisplayStatus;
    use std::collections::HashMap;

    fn bg_task(id: &str, kind: BackgroundWorkKind, description: &str) -> BackgroundTask {
        BackgroundTask {
            id: id.to_string(),
            kind,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: format!("tu-{id}"),
            command: "cmd".to_string(),
            description: description.to_string(),
            output_path: None,
            started_at: 5000,
            ended_at: None,
            status: BackgroundTaskStatus::Running,
            last_output_line: None,
            summary: None,
            usage: None,
            recovered: None,
            workflow_name: None,
            run_id: None,
        }
    }

    fn act(id: &str, kind: BackgroundWorkKind, description: &str) -> BackgroundActivityTask {
        BackgroundActivityTask {
            id: id.to_string(),
            kind,
            description: description.to_string(),
            started_at: 5000,
            workflow_name: None,
            run_id: None,
        }
    }

    #[test]
    fn main_only_working_no_background() {
        let mut chat = working_chat("c-working", None, true);
        enrich_chat(&mut chat, false, &[], None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Working));
        assert_eq!(chat.is_running, Some(true));
        assert_eq!(chat.background_activity, None);
    }

    #[test]
    fn background_only_idle_plus_live_tasks() {
        let mut chat = working_chat("c-idle", None, false);
        let tasks = vec![
            bg_task("a-1", BackgroundWorkKind::Agent, "reviewer"),
            bg_task("b-1", BackgroundWorkKind::Bash, "dev server"),
        ];
        enrich_chat(&mut chat, false, &tasks, None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Working));
        assert_eq!(chat.is_running, Some(false));
        let by_kind = HashMap::from([
            (BackgroundWorkKind::Agent, 1),
            (BackgroundWorkKind::Bash, 1),
        ]);
        assert_eq!(
            chat.background_activity,
            Some(BackgroundActivity {
                total: 2,
                by_kind,
                tasks: vec![
                    act("a-1", BackgroundWorkKind::Agent, "reviewer"),
                    act("b-1", BackgroundWorkKind::Bash, "dev server"),
                ],
            })
        );
    }

    #[test]
    fn both_main_turn_and_background() {
        let mut chat = working_chat("c-working", None, true);
        let tasks = vec![bg_task("w-1", BackgroundWorkKind::Workflow, "deploy")];
        enrich_chat(&mut chat, false, &tasks, None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Working));
        assert_eq!(chat.is_running, Some(true));
        assert_eq!(
            chat.background_activity,
            Some(BackgroundActivity {
                total: 1,
                by_kind: HashMap::from([(BackgroundWorkKind::Workflow, 1)]),
                tasks: vec![act("w-1", BackgroundWorkKind::Workflow, "deploy")],
            })
        );
    }

    #[test]
    fn terminal_tasks_do_not_count() {
        // Ended tasks never appear in listLive → an empty slice here.
        let mut chat = working_chat("c-idle", None, false);
        enrich_chat(&mut chat, false, &[], None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Idle));
        assert_eq!(chat.background_activity, None);
    }

    #[test]
    fn pending_permission_wins_over_background_activity() {
        let mut chat = working_chat("c-idle", None, false);
        let tasks = vec![bg_task("a-3", BackgroundWorkKind::Agent, "work")];
        enrich_chat(&mut chat, true, &tasks, None, None);
        assert_eq!(chat.display_status, Some(DisplayStatus::Waiting));
        assert_eq!(chat.is_running, Some(false));
        // The chip still shows the live background work while the gate is up.
        assert_eq!(chat.background_activity.map(|a| a.total), Some(1));
    }

    #[test]
    fn worktree_present_marks_directory_present() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        let mut chat = working_chat("c-wt-live", None, false);
        chat.worktree_path = Some(dir.path().to_string_lossy().into_owned());

        enrich_chat(&mut chat, false, &[], None, None);

        assert_eq!(chat.worktree_missing, Some(false));
        assert_eq!(chat.directory_missing, Some(false));
        assert_eq!(chat.missing_directory_path, None);
    }

    #[test]
    fn worktree_gone_marks_directory_missing() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("missing-worktree");
        let path = path.to_str().unwrap().to_string();
        let mut chat = working_chat("c-wt-gone", None, false);
        chat.worktree_path = Some(path.clone());

        enrich_chat(&mut chat, false, &[], Some("/project"), None);

        assert_eq!(chat.worktree_missing, Some(true));
        assert_eq!(chat.directory_missing, Some(true));
        assert_eq!(chat.missing_directory_path, Some(path));
    }

    #[test]
    fn project_path_gone_marks_directory_missing_without_worktree_missing() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("missing-project");
        let path = path.to_str().unwrap().to_string();
        let mut chat = working_chat("c-project-gone", None, false);

        enrich_chat(&mut chat, false, &[], Some(&path), None);

        assert_eq!(chat.worktree_missing, Some(false));
        assert_eq!(chat.directory_missing, Some(true));
        assert_eq!(chat.missing_directory_path, Some(path));
    }

    #[test]
    fn project_path_present_marks_directory_present() {
        let dir = tempfile::TempDir::new().unwrap();
        let mut chat = working_chat("c-project-live", None, false);

        enrich_chat(&mut chat, false, &[], dir.path().to_str(), None);

        assert_eq!(chat.worktree_missing, Some(false));
        assert_eq!(chat.directory_missing, Some(false));
        assert_eq!(chat.missing_directory_path, None);
    }

    #[test]
    fn missing_project_row_is_not_a_missing_directory() {
        let mut chat = working_chat("c-project-row-gone", None, false);

        enrich_chat(&mut chat, false, &[], None, None);

        assert_eq!(chat.worktree_missing, Some(false));
        assert_eq!(chat.directory_missing, Some(false));
        assert_eq!(chat.missing_directory_path, None);
    }
}

// ── chat-manager-degraded.test.ts ────────────────────────────────────────────
fn history_message() -> ChatMessage {
    ChatMessage {
        id: "m1".to_string(),
        chat_id: "sess-1".to_string(),
        r#type: ChatMessageType::Assistant,
        content: vec![MessageContent::Leaf(
            mainframe_types::content::LeafContent::Text {
                text: "hello from history".to_string(),
                parent_tool_use_id: None,
            },
        )],
        timestamp: "2026-07-08T00:00:00.000Z".to_string(),
        metadata: None,
    }
}

#[tokio::test]
async fn get_display_messages_reports_transcript_missing_persists_and_emits() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    let deps = StoreDeps::with_chats(vec![chat]);
    *deps.transcript_present.lock().unwrap() = Some(false); // transcript gone
    let mgr = ChatManager::new(deps.clone());

    let result = mgr.get_display_messages("c1").await;

    assert!(result.transcript_missing);
    assert_eq!(
        deps.store
            .lock()
            .unwrap()
            .get("c1")
            .unwrap()
            .transcript_missing,
        Some(true)
    );
    assert!(deps.events().iter().any(|e| matches!(
        e,
        DaemonEvent::ChatUpdated { chat, .. } if chat.transcript_missing == Some(true)
    )));
}

#[tokio::test]
async fn get_display_messages_self_heals_a_stale_flag() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    chat.transcript_missing = Some(true);
    let deps = StoreDeps::with_chats(vec![chat]);
    *deps.transcript_present.lock().unwrap() = Some(true); // transcript back
    *deps.history.lock().unwrap() = Some(vec![history_message()]);
    let mgr = ChatManager::new(deps.clone());

    let result = mgr.get_display_messages("c1").await;

    assert!(!result.transcript_missing);
    assert_eq!(
        deps.store
            .lock()
            .unwrap()
            .get("c1")
            .unwrap()
            .transcript_missing,
        Some(false)
    );
}

#[tokio::test]
async fn send_message_with_the_flag_clears_the_dead_session_identity() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    chat.transcript_missing = Some(true);
    chat.session_file_path = Some("/home/u/.claude/projects/x/sess-1.jsonl".to_string());
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps.clone());

    // No live session → the send triggers the auto "continue here" reset. The send
    // itself then can't spawn (no session double), but the reset already ran.
    let _ = mgr
        .send_message("c1", "continue after transcript loss", None, None)
        .await;

    let row = deps.store.lock().unwrap().get("c1").cloned().unwrap();
    assert_eq!(row.claude_session_id, None);
    assert_eq!(row.session_file_path, None);
    assert_eq!(row.transcript_missing, Some(false));
}

// ── external_session_service() facade wiring ────────────────────────────────

#[derive(Default)]
struct FakeExternalDeps {
    project: Mutex<Option<Project>>,
    sessions: Mutex<Vec<mainframe_types::adapter::ExternalSession>>,
    created: Mutex<Vec<(String, String)>>,
}

impl crate::external_session_service::ExternalSessionDeps for FakeExternalDeps {
    fn projects_get(&self, _project_id: &str) -> Option<Project> {
        self.project.lock().unwrap().clone()
    }
    fn get_imported_session_ids(&self, _project_id: &str) -> Vec<String> {
        Vec::new()
    }
    fn find_by_external_session_id(&self, _session_id: &str, _project_id: &str) -> Option<Chat> {
        None
    }
    fn chats_create(&self, project_id: &str, adapter_id: &str) -> Chat {
        self.created
            .lock()
            .unwrap()
            .push((project_id.to_string(), adapter_id.to_string()));
        let mut c = test_chat("imported");
        c.project_id = project_id.to_string();
        c.adapter_id = adapter_id.to_string();
        c
    }
    fn chats_update(
        &self,
        _chat_id: &str,
        _updates: &crate::external_session_service::ExternalChatUpdate,
    ) {
    }
    fn chats_list(&self, _project_id: &str) -> Vec<Chat> {
        Vec::new()
    }
    fn settings_get(&self, _ns: &str, _key: &str) -> Option<String> {
        None
    }
    fn emit_event(&self, _event: DaemonEvent) {}
    fn generate_title<'a>(
        &'a self,
        _adapter_id: &'a str,
        _content: &'a str,
        _binary: &'a str,
    ) -> BoxFuture<'a, Option<String>> {
        Box::pin(async { None })
    }
    fn external_session_adapter_ids(&self) -> Vec<String> {
        vec!["claude".to_string()]
    }
    fn list_external_sessions<'a>(
        &'a self,
        _adapter_id: &'a str,
        _project_path: &'a str,
        _exclude_ids: &'a [String],
        _offset: i64,
        _limit: i64,
    ) -> BoxFuture<'a, Result<ExternalSessionPage, AdapterError>> {
        let sessions = self.sessions.lock().unwrap().clone();
        let total = sessions.len() as i64;
        Box::pin(async move {
            Ok(ExternalSessionPage {
                sessions,
                total,
                next_offset: None,
            })
        })
    }
}

fn external_session(id: &str) -> mainframe_types::adapter::ExternalSession {
    mainframe_types::adapter::ExternalSession {
        session_id: id.to_string(),
        adapter_id: "claude".to_string(),
        project_path: "/tmp/p".to_string(),
        cwd: None,
        first_prompt: None,
        title: None,
        summary: None,
        message_count: None,
        created_at: "now".to_string(),
        modified_at: "now".to_string(),
        git_branch: None,
        model: None,
    }
}

#[tokio::test]
async fn external_session_service_is_none_until_injected() {
    let mgr = ChatManager::new(StoreDeps::arc());
    assert!(mgr.external_session_service().is_none());
}

#[tokio::test]
async fn with_external_sessions_wires_scan_page_through_the_facade() {
    let ext = Arc::new(FakeExternalDeps::default());
    *ext.project.lock().unwrap() = Some(Project {
        id: "p1".into(),
        name: "p".into(),
        path: "/tmp/p".into(),
        created_at: "now".into(),
        last_opened_at: "now".into(),
        parent_project_id: None,
        available: None,
    });
    ext.sessions.lock().unwrap().push(external_session("s1"));
    let service = Arc::new(ExternalSessionService::new(ext));
    let mgr = ChatManager::new(StoreDeps::arc()).with_external_sessions(service);

    let facade = mgr.external_session_service().expect("service injected");
    let page = facade.scan_page("p1", 0, 50).await;

    assert_eq!(page.total, 1);
    assert_eq!(page.sessions[0].session_id, "s1");
}

#[tokio::test]
async fn with_external_sessions_wires_import_session_through_the_facade() {
    let ext = Arc::new(FakeExternalDeps::default());
    let service = Arc::new(ExternalSessionService::new(ext.clone()));
    let mgr = ChatManager::new(StoreDeps::arc()).with_external_sessions(service);

    let facade = mgr.external_session_service().expect("service injected");
    let chat = facade
        .import_session("p1", "s1", "claude", None, None, None)
        .await;

    assert_eq!(chat.project_id, "p1");
    assert_eq!(chat.adapter_id, "claude");
    assert_eq!(
        ext.created.lock().unwrap().as_slice(),
        [("p1".to_string(), "claude".to_string())]
    );
}

#[tokio::test]
async fn import_session_title_drops_the_session_reference_preamble() {
    let ext = Arc::new(FakeExternalDeps::default());
    let service = Arc::new(ExternalSessionService::new(ext.clone()));
    let mgr = ChatManager::new(StoreDeps::arc()).with_external_sessions(service);

    let facade = mgr.external_session_service().expect("service injected");
    let chat = facade
        .import_session(
            "p1",
            "s1",
            "claude",
            Some("Referenced session @session[Model Identity]: /repo/a.jsonl\n\nlook at this"),
            None,
            None,
        )
        .await;

    assert_eq!(chat.title.as_deref(), Some("look at this"));
}

// ── trust_workspace ─────────────────────────────────────────────────────────

#[tokio::test]
async fn trust_workspace_persists_the_project_root_when_the_chat_has_no_worktree() {
    let deps = StoreDeps::with_chats(vec![test_chat("c1")]);
    let mgr = ChatManager::new(deps.clone());

    mgr.trust_workspace("c1").await.unwrap();

    assert_eq!(*deps.trusted_paths.lock().unwrap(), vec!["/tmp/test"]);
}

#[tokio::test]
async fn trust_workspace_prefers_the_chat_worktree_path_over_the_project_root() {
    let mut chat = test_chat("c1");
    chat.worktree_path = Some("/home/me/proj-wt".to_string());
    let deps = StoreDeps::with_chats(vec![chat]);
    let mgr = ChatManager::new(deps.clone());

    mgr.trust_workspace("c1").await.unwrap();

    assert_eq!(
        *deps.trusted_paths.lock().unwrap(),
        vec!["/home/me/proj-wt"]
    );
}

#[tokio::test]
async fn trust_workspace_errors_when_the_chat_is_missing() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());

    let err = mgr.trust_workspace("missing").await.unwrap_err();

    assert!(matches!(err, TrustWorkspaceError::ChatNotFound(id) if id == "missing"));
    assert!(deps.trusted_paths.lock().unwrap().is_empty());
}

#[tokio::test]
async fn trust_workspace_propagates_a_write_failure_without_gating_being_bypassed() {
    let deps = StoreDeps::with_chats(vec![test_chat("c1")]);
    *deps.fail_trust_write.lock().unwrap() = Some("disk full".to_string());
    let mgr = ChatManager::new(deps.clone());

    let err = mgr.trust_workspace("c1").await.unwrap_err();

    assert!(matches!(err, TrustWorkspaceError::Write(msg) if msg == "disk full"));
}

// ── accept_worktree_offer gating ────────────────────────────────────────────

#[tokio::test]
async fn accept_worktree_offer_refuses_while_a_turn_is_in_flight() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        RecSession::new("c1", true, true),
    );

    let err = mgr
        .accept_worktree_offer("c1", "/tmp/wt")
        .await
        .unwrap_err();

    assert!(matches!(err, OfferError::ChatBusy));
    assert_eq!(err.status_code(), 409);
}

/// Idle reaches the registry instead — `NotPending` proves the busy gate let it
/// through, since nothing was ever offered here.
#[tokio::test]
async fn accept_worktree_offer_reaches_the_registry_when_the_chat_is_idle() {
    let deps = StoreDeps::arc();
    let mgr = ChatManager::new(deps.clone());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), false),
        RecSession::new("c1", true, true),
    );

    let err = mgr
        .accept_worktree_offer("c1", "/tmp/wt")
        .await
        .unwrap_err();

    assert!(matches!(err, OfferError::NotPending));
}

// ── composer-driven rebinds (enable / attach / disable) ─────────────────────

/// The composer's worktree control reaches the config manager directly, not
/// through an offer, so each of its three rebinds needs the same busy gate.
async fn working_manager(working: bool) -> ChatManager {
    let mgr = ChatManager::new(StoreDeps::arc());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), working),
        RecSession::new("c1", true, true),
    );
    mgr
}

#[tokio::test]
async fn enable_worktree_refuses_while_a_turn_is_in_flight() {
    let mgr = working_manager(true).await;

    let err = mgr
        .enable_worktree("c1", "main", "feat/x")
        .await
        .unwrap_err();

    assert!(matches!(err, ConfigError::ChatBusy));
}

#[tokio::test]
async fn attach_worktree_refuses_while_a_turn_is_in_flight() {
    let mgr = working_manager(true).await;

    let err = mgr
        .attach_worktree("c1", "/tmp/wt", Some("feat/x"))
        .await
        .unwrap_err();

    assert!(matches!(err, ConfigError::ChatBusy));
}

#[tokio::test]
async fn disable_worktree_refuses_while_a_turn_is_in_flight() {
    let mgr = working_manager(true).await;

    let err = mgr.disable_worktree("c1").await.unwrap_err();

    assert!(matches!(err, ConfigError::ChatBusy));
}

#[tokio::test]
async fn attach_worktree_rebinds_when_the_chat_is_idle() {
    let mgr = working_manager(false).await;

    mgr.attach_worktree("c1", "/tmp/wt", Some("feat/x"))
        .await
        .unwrap();

    let chat = mgr.get_chat("c1").expect("chat");
    assert_eq!(chat.worktree_path.as_deref(), Some("/tmp/wt"));
    assert_eq!(chat.branch_name.as_deref(), Some("feat/x"));
}
