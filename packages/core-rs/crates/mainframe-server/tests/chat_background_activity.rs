//! Wiring-level regression coverage for #273: the daemon's production
//! `ChatManagerDeps` (`DaemonChatDeps`, assembled by `build_chat_manager`) must
//! feed `ChatManager` enrichment the tracker's real live-task set. Unlike
//! `mainframe-chat`'s `background_activity` unit tests — which call the private
//! `enrich_chat` directly with a hand-built task vec — these tests drive the
//! production stack end to end: a real `BackgroundTaskTracker` seeded through
//! its own `start`/`end` API, read back only through `ChatManager`'s public
//! broadcast and read paths. A regression where `tracker_list_live` silently
//! falls back to an empty default would fail every case here.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use mainframe_adapter_api::AdapterRegistry;
use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskSeed, TerminalUpdate};
use mainframe_chat::chat_manager::ChatManager;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_db::DatabaseManager;
use mainframe_server::chat_seams::{NoopLaunchStopper, NoopScopeTunnelStopper};
use mainframe_server::{Db, GitFactory, build_chat_manager};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::push::PushService;
use mainframe_services::quota::{QuotaManager, QuotaManagerDeps, QuotaSettingsStore};
use mainframe_types::background_task::{
    BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind,
};
use mainframe_types::chat::{Chat, DisplayStatus};
use mainframe_types::events::DaemonEvent;
use tempfile::TempDir;
use tokio::sync::broadcast;

struct NoopQuotaSettings;

impl QuotaSettingsStore for NoopQuotaSettings {
    fn get(&self, _category: &str, _key: &str) -> Option<String> {
        None
    }
    fn get_by_category(&self, _category: &str) -> HashMap<String, String> {
        HashMap::new()
    }
    fn set(&self, _category: &str, _key: &str, _value: &str) {}
}

struct Harness {
    manager: Arc<ChatManager>,
    tracker: Arc<BackgroundTaskTracker>,
    broadcast: broadcast::Sender<DaemonEvent>,
    project_id: String,
    chat_id: String,
    _data_dir: TempDir,
}

fn harness() -> Harness {
    let data_dir = tempfile::tempdir().unwrap();
    let db = Db::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap();
    let (broadcast, _keepalive) = broadcast::channel::<DaemonEvent>(64);
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings: Box::new(NoopQuotaSettings),
        emit_event: Box::new(|_| {}),
        now: None,
    }));

    let path = data_dir.path().to_string_lossy().into_owned();
    let project = db
        .call_blocking(move |d| d.projects.create(&path, None))
        .unwrap();
    let project_id_for_chat = project.id.clone();
    let chat = db
        .call_blocking(move |d| {
            d.chats
                .create(&project_id_for_chat, "claude", None, None, None)
        })
        .unwrap();

    let manager = build_chat_manager(
        db,
        Arc::new(AdapterRegistry::new()),
        Arc::clone(&tracker),
        Arc::new(AttachmentStore::new(data_dir.path().join("attachments"))),
        Arc::new(PushService::new()),
        GitFactory,
        broadcast.clone(),
        Arc::new(NoopLaunchStopper),
        Arc::new(NoopScopeTunnelStopper),
        quota,
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
        None,
    );

    Harness {
        manager,
        tracker,
        broadcast,
        project_id: project.id,
        chat_id: chat.id,
        _data_dir: data_dir,
    }
}

fn seed(h: &Harness, id: &str, kind: BackgroundWorkKind, description: &str) {
    h.tracker.start(
        &h.chat_id,
        TaskSeed {
            id: id.to_string(),
            kind,
            tool_name: BackgroundTaskToolName::Monitor,
            tool_use_id: format!("tu-{id}"),
            command: "cmd".to_string(),
            description: description.to_string(),
            workflow_name: None,
        },
        format!("/tmp/mf-273-{id}.log"),
    );
}

fn assert_live(chat: &Chat, total: u32) {
    let activity = chat
        .background_activity
        .as_ref()
        .expect("background_activity must be populated for a live task");
    assert_eq!(activity.total, total);
    assert_eq!(chat.display_status, Some(DisplayStatus::Working));
    assert_eq!(chat.is_running, Some(false));
}

#[tokio::test]
async fn chat_updated_broadcast_carries_background_activity_for_every_kind() {
    let h = harness();
    seed(&h, "a-1", BackgroundWorkKind::Agent, "reviewer");
    seed(&h, "b-1", BackgroundWorkKind::Bash, "dev server");
    seed(&h, "w-1", BackgroundWorkKind::Workflow, "deploy");

    let mut rx = h.broadcast.subscribe();
    h.manager.rename_chat(&h.chat_id, "renamed");

    let chat = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match rx.recv().await.expect("broadcast channel closed") {
                DaemonEvent::ChatUpdated { chat, .. } => return chat,
                _ => continue,
            }
        }
    })
    .await
    .expect("chat.updated within 5s");

    let activity = chat
        .background_activity
        .as_ref()
        .expect("background_activity must be Some with three live tasks");
    assert_eq!(activity.total, 3);
    assert_eq!(
        activity.by_kind,
        HashMap::from([
            (BackgroundWorkKind::Agent, 1),
            (BackgroundWorkKind::Bash, 1),
            (BackgroundWorkKind::Workflow, 1),
        ])
    );
    let mut ids: Vec<&str> = activity.tasks.iter().map(|t| t.id.as_str()).collect();
    ids.sort_unstable();
    assert_eq!(ids, vec!["a-1", "b-1", "w-1"]);
    assert_eq!(chat.display_status, Some(DisplayStatus::Working));
    assert_eq!(chat.is_running, Some(false));
}

#[tokio::test]
async fn read_paths_enrich_background_activity() {
    let h = harness();
    seed(&h, "w-1", BackgroundWorkKind::Workflow, "deploy");

    assert_live(&h.manager.get_chat(&h.chat_id).expect("chat must exist"), 1);
    let listed = h.manager.list_chats(&h.project_id);
    assert_live(listed.iter().find(|c| c.id == h.chat_id).unwrap(), 1);
    let listed_all = h.manager.list_all_chats();
    assert_live(listed_all.iter().find(|c| c.id == h.chat_id).unwrap(), 1);
    let filtered = h
        .manager
        .list_filtered(Some(&h.project_id), None, false, false);
    assert_live(filtered.iter().find(|c| c.id == h.chat_id).unwrap(), 1);
}

#[tokio::test]
async fn ended_tasks_drop_out_of_the_live_set() {
    let h = harness();

    let before = h.manager.get_chat(&h.chat_id).expect("chat must exist");
    assert_eq!(before.background_activity, None);
    assert_eq!(before.display_status, Some(DisplayStatus::Idle));
    assert_eq!(before.is_running, Some(false));

    seed(&h, "a-1", BackgroundWorkKind::Agent, "reviewer");
    assert_live(&h.manager.get_chat(&h.chat_id).expect("chat must exist"), 1);

    h.tracker.end(
        &h.chat_id,
        "a-1",
        TerminalUpdate {
            status: BackgroundTaskStatus::Completed,
            output_path: "/tmp/mf-273-a-1.log".to_string(),
            summary: String::new(),
            usage: None,
        },
    );

    let after = h.manager.get_chat(&h.chat_id).expect("chat must exist");
    assert_eq!(after.background_activity, None);
    assert_eq!(after.display_status, Some(DisplayStatus::Idle));
}
