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
    ) -> Chat {
        test_chat("new")
    }
    fn chats_update(&self, chat_id: &str, patch: &ChatUpdate) {
        self.updates
            .lock()
            .unwrap()
            .push((chat_id.to_string(), patch.clone()));
        if let Some(ps) = patch.process_state
            && let Some(c) = self.store.lock().unwrap().get_mut(chat_id)
        {
            c.process_state = Some(ps);
        }
    }
    fn chats_list(&self, _project_id: &str) -> Vec<Chat> {
        self.store.lock().unwrap().values().cloned().collect()
    }
    fn chats_list_all(&self) -> Vec<Chat> {
        self.store.lock().unwrap().values().cloned().collect()
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
        None
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
    fn apply_codex_provider_tuning(&self, _session: &Arc<dyn AdapterSession>) {}
    fn generate_title<'a>(
        &'a self,
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

// Keep ChatStatus referenced (used by test_chat defaults).
#[allow(dead_code)]
fn _status() -> ChatStatus {
    ChatStatus::Active
}
