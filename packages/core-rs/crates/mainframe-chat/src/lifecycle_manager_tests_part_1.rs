use super::*;
use crate::fork::PendingForkState;
use crate::test_support::FakeSession;
use mainframe_adapter_api::AdapterSession;
use mainframe_types::settings_kv::{MemorySettings, SettingsKv};

pub(super) fn chat_over(id: &str, worktree: Option<&str>, status: ChatStatus) -> Chat {
    crate::test_support::ChatBuilder::new(id)
        .worktree(worktree)
        .status(status)
        .build()
}

// ── is_last_active_chat_for_scope ─────────────────────────────────────────
#[test]
fn false_when_a_non_archived_sibling_shares_the_worktree_scope() {
    let chats = vec![
        chat_over("c1", Some("/wt/x"), ChatStatus::Active),
        chat_over("c2", Some("/wt/x"), ChatStatus::Active),
    ];
    assert!(!is_last_active_chat_for_scope(
        &chats, "/proj", "/wt/x", "c1"
    ));
}

#[test]
fn false_when_a_non_archived_sibling_shares_the_project_root_scope() {
    let chats = vec![
        chat_over("c1", None, ChatStatus::Active),
        chat_over("c2", None, ChatStatus::Active),
    ];
    assert!(!is_last_active_chat_for_scope(
        &chats, "/proj", "/proj", "c1"
    ));
}

#[test]
fn true_for_a_unique_worktree_scope() {
    let chats = vec![
        chat_over("c1", Some("/wt/x"), ChatStatus::Active),
        chat_over("c2", Some("/wt/y"), ChatStatus::Active),
    ];
    assert!(is_last_active_chat_for_scope(
        &chats, "/proj", "/wt/x", "c1"
    ));
}

#[test]
fn ignores_archived_siblings_on_the_same_scope() {
    let chats = vec![
        chat_over("c1", Some("/wt/x"), ChatStatus::Active),
        chat_over("c2", Some("/wt/x"), ChatStatus::Archived),
    ];
    assert!(is_last_active_chat_for_scope(
        &chats, "/proj", "/wt/x", "c1"
    ));
}

#[test]
fn excludes_the_chat_being_archived_from_the_count() {
    let chats = vec![chat_over("c1", Some("/wt/x"), ChatStatus::Active)];
    assert!(is_last_active_chat_for_scope(
        &chats, "/proj", "/wt/x", "c1"
    ));
}

// ── archiveChat (kills-tasks + releases-scope) ───────────────────────────
pub(super) use crate::test_support::FakeDeps;

/// The shared fake with `chat` and its `siblings` stored in a project at
/// `/proj` whose launch scope can be stopped.
pub(super) fn fake(chat: Chat, siblings: Vec<Chat>) -> Arc<FakeDeps> {
    let mut chats = vec![chat];
    chats.extend(siblings);
    let deps = FakeDeps::with_chats(chats);
    deps.set_project_path("/proj");
    *deps.workspace.has_launches.lock().unwrap() = true;
    deps
}

/// `fake`, over a scope that never ran a launch config (where
/// `LaunchRegistry::get` yields `None` and `stop_launch_processes` with it).
fn launchless(chat: Chat, siblings: Vec<Chat>) -> Arc<FakeDeps> {
    let deps = fake(chat, siblings);
    *deps.workspace.has_launches.lock().unwrap() = false;
    deps
}

pub(super) fn title_disabled(chat: Chat) -> Arc<FakeDeps> {
    let deps = FakeDeps {
        settings: MemorySettings::default().with("general", "titleGeneration.disabled", "true"),
        ..FakeDeps::default()
    };
    deps.store.insert(chat);
    deps.set_project_path("/proj");
    *deps.workspace.has_launches.lock().unwrap() = true;
    Arc::new(deps)
}

/// Like [`fake`], but `adapter_supports_no_persistence` answers `true`
/// and `create_session` hands out `session` (so `do_start_chat` reaches
/// the rule-7 flag write before its `spawn()` call).
pub(super) fn no_persistence_capable(
    chat: Chat,
    session: Arc<dyn AdapterSession>,
) -> Arc<FakeDeps> {
    let deps = fake(chat, Vec::new());
    deps.set_session_to_return(session);
    *deps.adapters.no_persistence_capability.lock().unwrap() = true;
    deps
}

/// Titles the store observed `chats_update` writing.
pub(super) fn title_updates(deps: &FakeDeps) -> Vec<String> {
    deps.store
        .updates
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(_, patch)| patch.title.clone())
        .collect()
}

/// Every `vendor_session_ephemeral` value `chats_update` observed.
fn vendor_session_ephemeral_updates(deps: &FakeDeps) -> Vec<bool> {
    deps.store
        .updates
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(_, patch)| patch.vendor_session_ephemeral)
        .collect()
}

async fn set_saved_default_model(deps: &FakeDeps, adapter_id: &str, model: Option<&str>) {
    let key = format!("{adapter_id}.defaultModel");
    match model {
        Some(model) => deps.settings.set("provider", &key, model).await.unwrap(),
        None => deps.settings.delete("provider", &key).await.unwrap(),
    }
}

/// A lifecycle manager over `deps`, with the event handler and offer
/// registry it needs built over the same shared state.
pub(super) fn manager(deps: Arc<FakeDeps>) -> ChatLifecycleManager {
    let shared = ChatShared::new(deps);
    let offers = Arc::new(WorktreeOfferRegistry::new(shared.clone()));
    let handler = Arc::new(EventHandler::new(shared.clone(), offers.clone()));
    ChatLifecycleManager::new(shared, handler, offers)
}

#[tokio::test]
async fn fork_to_worktree_keeps_accept_edits_permission_mode() {
    let mut source = chat_over("source", None, ChatStatus::Active);
    source.permission_mode = Some(ExecutionMode::AcceptEdits);
    let deps = fake(source, Vec::new());
    let mgr = manager(deps.clone());

    mgr.fork_to_worktree("source", "main", "feature")
        .await
        .unwrap();

    let created = deps.store.created.lock().unwrap();
    let permission = created[0].permission_mode.as_deref();
    assert_eq!(permission, Some("acceptEdits"));
    let parsed: ExecutionMode =
        serde_json::from_value(serde_json::Value::String(permission.unwrap().to_string())).unwrap();
    assert_eq!(parsed, ExecutionMode::AcceptEdits);
}

#[tokio::test]
async fn calls_kill_tasks_before_session_kill_with_worktree_path() {
    let chat = {
        let mut c = chat_over("c1", Some("/wt/x"), ChatStatus::Active);
        c.branch_name = Some("feat/x".to_string());
        c
    };
    let deps = fake(chat.clone(), Vec::new());
    let mgr = manager(deps.clone());
    // Insert an active chat whose FakeSession records its own kill order.
    let session = FakeSession::with_activity(true, None);
    mgr.shared.active_chats.insert(
        "c1".to_string(),
        Arc::new(Mutex::new(ActiveChat::new(chat, Some(session.clone())))),
    );

    mgr.archive_chat("c1", true).await;

    // killTasksForChat is called (with the worktree path) BEFORE session.kill;
    // the deps seam records the kill-tasks call and FakeSession counts its kill.
    let order = deps.workspace.order.lock().unwrap();
    assert!(order.iter().any(|s| s == "kill:c1:/wt/x"));
    assert_eq!(session.kills(), 1);
}

#[tokio::test]
async fn last_user_stops_launches_and_emits_scope_released() {
    let chat = {
        let mut c = chat_over("c1", Some("/wt/x"), ChatStatus::Active);
        c.branch_name = Some("feat/x".to_string());
        c
    };
    let deps = fake(chat, Vec::new());
    let mgr = manager(deps.clone());
    mgr.archive_chat("c1", false).await; // keep-worktree

    assert_eq!(
        deps.workspace.stop_calls.lock().unwrap().as_slice(),
        &[("p1".to_string(), "/wt/x".to_string())]
    );
    assert_eq!(
        deps.workspace.tunnel_stop_calls.lock().unwrap().as_slice(),
        &[("p1".to_string(), "/wt/x".to_string())]
    );
    assert!(deps.emitter.events.lock().unwrap().iter().any(|e| matches!(
        e,
        DaemonEvent::LaunchScopeReleased { project_id, effective_path }
            if project_id == "p1" && effective_path == "/wt/x"
    )));
}

/// Port tunnels outlive every scope whose teardown hangs off the launch
/// registry: a chat that never ran a launch config gets `None` from
/// `stop_launch_processes`, so the tunnel stop has to be its own seam.
#[tokio::test]
async fn launchless_scope_release_still_stops_port_tunnels() {
    let chat = {
        let mut c = chat_over("c1", Some("/wt/x"), ChatStatus::Active);
        c.branch_name = Some("feat/x".to_string());
        c
    };
    let deps = launchless(chat, Vec::new());
    let mgr = manager(deps.clone());
    mgr.archive_chat("c1", false).await;

    assert!(deps.workspace.stop_calls.lock().unwrap().is_empty());
    assert_eq!(
        deps.workspace.tunnel_stop_calls.lock().unwrap().as_slice(),
        &[("p1".to_string(), "/wt/x".to_string())]
    );
    assert!(deps.emitter.events.lock().unwrap().iter().any(|e| matches!(
        e,
        DaemonEvent::LaunchScopeReleased { project_id, effective_path }
            if project_id == "p1" && effective_path == "/wt/x"
    )));
}

#[tokio::test]
async fn shared_scope_keeps_the_scope_alive() {
    let chat = {
        let mut c = chat_over("c1", Some("/wt/x"), ChatStatus::Active);
        c.branch_name = Some("feat/x".to_string());
        c
    };
    let sibling = chat_over("c2", Some("/wt/x"), ChatStatus::Active);
    let deps = fake(chat, vec![sibling]);
    let mgr = manager(deps.clone());
    mgr.archive_chat("c1", false).await;

    assert!(deps.workspace.stop_calls.lock().unwrap().is_empty());
    assert!(deps.workspace.tunnel_stop_calls.lock().unwrap().is_empty());
    assert!(
        !deps
            .emitter
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, DaemonEvent::LaunchScopeReleased { .. }))
    );
}
