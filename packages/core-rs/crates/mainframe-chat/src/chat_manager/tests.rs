//! Ports the chat-manager `__tests__` (cli-queue, recover-working, turn-timing,
//! command-routing, remove-project-kills-tasks) assertion-for-assertion.

use super::*;
use crate::test_support::test_chat;
use mainframe_adapter_api::{ContextFiles, ImageInput, SessionSink, StopBackgroundTaskResult};
use mainframe_types::adapter::{AdapterProcess, ControlResponse, SessionSpawnOptions};
use mainframe_types::chat::{Chat, ChatStatus, ProcessState};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::settings::ExecutionMode;
use std::sync::atomic::{AtomicUsize, Ordering};

// ── fake ChatManagerDeps ─────────────────────────────────────────────────────

#[derive(Default)]
struct StoreDeps {
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
    /// Records every path `trust_workspace` persisted, for assertion.
    trusted_paths: Mutex<Vec<String>>,
    /// When `Some`, `write_workspace_trust` fails with this message instead of
    /// recording the call.
    fail_trust_write: Mutex<Option<String>>,
}

impl StoreDeps {
    fn arc() -> Arc<Self> {
        Arc::new(Self::default())
    }
    fn with_chats(chats: Vec<Chat>) -> Arc<Self> {
        let d = Self::default();
        {
            let mut s = d.store.lock().unwrap();
            for c in chats {
                s.insert(c.id.clone(), c);
            }
        }
        Arc::new(d)
    }
    fn events(&self) -> Vec<DaemonEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl ChatManagerDeps for StoreDeps {
    fn emit_event(&self, event: DaemonEvent) {
        self.events.lock().unwrap().push(event);
    }
    fn get_tool_categories(&self, _chat_id: &str) -> Option<ToolCategories> {
        None
    }
    fn prepare_messages_for_client(
        &self,
        _raw: &[ChatMessage],
        _categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        Vec::new()
    }
    fn strip_command_tags(&self, text: &str) -> String {
        text.to_string()
    }
    fn chats_get(&self, id: &str) -> Option<Chat> {
        self.store.lock().unwrap().get(id).cloned()
    }
    fn chats_create(
        &self,
        _project_id: &str,
        _adapter_id: &str,
        _model: Option<&str>,
        _permission_mode: Option<&str>,
        _automation_run_id: Option<&str>,
    ) -> Chat {
        test_chat("new")
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
        }
    }
    fn chats_list(&self, _project_id: &str) -> Vec<Chat> {
        self.store.lock().unwrap().values().cloned().collect()
    }
    fn chats_list_all(&self) -> Vec<Chat> {
        self.store.lock().unwrap().values().cloned().collect()
    }
    fn chats_list_filtered(
        &self,
        _project_id: Option<&str>,
        _tags_all: Option<&[String]>,
        _has_worktree: bool,
        _include_archived: bool,
    ) -> Vec<Chat> {
        self.store.lock().unwrap().values().cloned().collect()
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
    fn projects_remove(&self, project_id: &str) {
        self.project_removed
            .lock()
            .unwrap()
            .push(project_id.to_string());
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
        _options: mainframe_types::adapter::SessionOptions,
    ) -> Option<Arc<dyn AdapterSession>> {
        self.history.lock().unwrap().clone().map(|history| {
            Arc::new(crate::test_support::FakeSession {
                history,
                ..Default::default()
            }) as Arc<dyn AdapterSession>
        })
    }
    fn attachment_delete_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn process_attachments<'a>(
        &'a self,
        _chat_id: &'a str,
        _attachment_ids: &'a [String],
    ) -> BoxFuture<'a, ProcessedAttachments> {
        Box::pin(async { ProcessedAttachments::default() })
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
        _content: &'a str,
        _binary: &'a str,
    ) -> BoxFuture<'a, Option<String>> {
        Box::pin(async { None })
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
    fn extract_mentions_from_text(&self, _chat_id: &str, _text: &str) -> bool {
        false
    }
    fn tracker_remove_chat(&self, _chat_id: &str) {}
    fn is_transcript_present<'a>(
        &'a self,
        _adapter_id: &'a str,
        _session_id: &'a str,
        _project_path: &'a str,
        _session_file_path: Option<&'a str>,
    ) -> BoxFuture<'a, Option<bool>> {
        let present = *self.transcript_present.lock().unwrap();
        Box::pin(async move { present })
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
        _images: Vec<ImageInput>,
        uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        self.send_message_calls
            .lock()
            .unwrap()
            .push((message, uuid));
        ok()
    }
    fn respond_to_permission(
        &self,
        _response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn set_model(&self, _model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        ok()
    }
    fn set_permission_mode(&self, _mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
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
        Arc::new(Mutex::new(ActiveChat {
            chat,
            session: Some(session),
            turn_started_at: None,
        })),
    );
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
    assert!(
        deps.events()
            .iter()
            .any(|e| matches!(e, DaemonEvent::MessageQueued { .. }))
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
    assert!(
        deps.events().iter().any(
            |e| matches!(e, DaemonEvent::MessageQueuedCancelled { uuid, .. } if *uuid == r.uuid)
        )
    );
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

    mgr.remove_project("p1").await;

    let order = order.lock().unwrap();
    let idx = |s: &str| order.iter().position(|x| x == s);
    assert!(idx("kill:c1:/wt/c1").unwrap() < idx("sess.kill:c1").unwrap());
    assert!(idx("kill:c2:no-wt").unwrap() < idx("sess.kill:c2").unwrap());
    assert_eq!(
        deps.project_removed.lock().unwrap().as_slice(),
        &["p1".to_string()]
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
        }
    }

    fn act(id: &str, kind: BackgroundWorkKind, description: &str) -> BackgroundActivityTask {
        BackgroundActivityTask {
            id: id.to_string(),
            kind,
            description: description.to_string(),
            started_at: 5000,
        }
    }

    #[test]
    fn main_only_working_no_background() {
        let mut chat = working_chat("c-working", None, true);
        super::enrich_chat(&mut chat, false, &[]);
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
        super::enrich_chat(&mut chat, false, &tasks);
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
        super::enrich_chat(&mut chat, false, &tasks);
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
        super::enrich_chat(&mut chat, false, &[]);
        assert_eq!(chat.display_status, Some(DisplayStatus::Idle));
        assert_eq!(chat.background_activity, None);
    }

    #[test]
    fn pending_permission_wins_over_background_activity() {
        let mut chat = working_chat("c-idle", None, false);
        let tasks = vec![bg_task("a-3", BackgroundWorkKind::Agent, "work")];
        super::enrich_chat(&mut chat, true, &tasks);
        assert_eq!(chat.display_status, Some(DisplayStatus::Waiting));
        assert_eq!(chat.is_running, Some(false));
        // The chip still shows the live background work while the gate is up.
        assert_eq!(chat.background_activity.map(|a| a.total), Some(1));
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
