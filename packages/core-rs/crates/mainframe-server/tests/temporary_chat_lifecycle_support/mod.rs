//! Harness for todo #346's G2b integration tests: a real `ChatManager` (via
//! `build_chat_manager`, production `DaemonChatDeps`) over an in-memory DB,
//! paired with the `session` module's minimal `Adapter`/`AdapterSession`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

pub mod session;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use mainframe_adapter_api::Adapter;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_chat::chat_manager::ChatManager;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_db::DatabaseManager;
use mainframe_server::chat_seams::{NoopLaunchStopper, NoopScopeTunnelStopper};
use mainframe_server::{Db, GitFactory, build_chat_manager};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::push::PushService;
use mainframe_services::quota::{QuotaManager, QuotaManagerDeps, QuotaSettingsStore};
use mainframe_types::chat::{Chat, NewChat};
use tempfile::TempDir;
use tokio::sync::broadcast;

pub use session::{ADAPTER_ID, TestAdapter};

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

pub struct Harness {
    pub db: Db,
    pub broadcast: broadcast::Sender<mainframe_types::events::DaemonEvent>,
    pub project_id: String,
    pub data_dir: TempDir,
}

/// Builds the harness's shared (in-memory) DB, project row and broadcast
/// channel, but no `ChatManager` yet — call [`rebuild_manager`] to get one
/// (and again, over the same `db`, to simulate a restart).
pub fn harness() -> Harness {
    let data_dir = tempfile::tempdir().unwrap();
    let db = Db::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap();
    let (broadcast, _keepalive) = broadcast::channel(64);
    let path = data_dir.path().to_string_lossy().into_owned();
    let project = db
        .call_blocking(move |d| d.projects.create(&path, None))
        .unwrap();
    Harness {
        db,
        broadcast,
        project_id: project.id,
        data_dir,
    }
}

/// A fresh `ChatManager` over `h.db` — every call models "a new manager over
/// the same DB" (a restart): the active-chat registry starts empty even
/// though the DB rows persist.
pub fn rebuild_manager(h: &Harness, adapter: Arc<dyn Adapter>) -> Arc<ChatManager> {
    let registry = Arc::new(mainframe_adapter_api::AdapterRegistry::new());
    registry.register(adapter);
    let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings: Box::new(NoopQuotaSettings),
        emit_event: Box::new(|_| {}),
        now: None,
    }));
    build_chat_manager(
        h.db.clone(),
        registry,
        Arc::new(BackgroundTaskTracker::new()),
        Arc::new(AttachmentStore::new(h.data_dir.path().join("attachments"))),
        Arc::new(PushService::new()),
        GitFactory,
        h.broadcast.clone(),
        Arc::new(NoopLaunchStopper),
        Arc::new(NoopScopeTunnelStopper),
        quota,
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
        None,
        h.data_dir.path().to_path_buf(),
    )
}

/// Creates a project-scoped chat directly through the DB (bypassing the route
/// validator, like the other `mainframe-server` harnesses).
pub fn create_chat(h: &Harness, temporary: bool) -> Chat {
    let project_id = h.project_id.clone();
    h.db.call_blocking(move |d| {
        d.chats.create(&NewChat {
            project_id,
            adapter_id: ADAPTER_ID.to_string(),
            temporary,
            ..Default::default()
        })
    })
    .unwrap()
}

/// Creates a non-project (scratch) chat directly through the DB.
pub fn create_no_project_chat(h: &Harness, temporary: bool) -> Chat {
    let scratch_root = h
        .data_dir
        .path()
        .join("scratch")
        .to_string_lossy()
        .into_owned();
    h.db.call_blocking(move |d| {
        d.chats.create(&NewChat {
            project_id: mainframe_types::chat::NO_PROJECT_ID.to_string(),
            adapter_id: ADAPTER_ID.to_string(),
            temporary,
            scratch_root: Some(scratch_root),
            ..Default::default()
        })
    })
    .unwrap()
}

pub fn get_chat(h: &Harness, chat_id: &str) -> Chat {
    let id = chat_id.to_string();
    h.db.call_blocking(move |d| d.chats.get(&id))
        .unwrap()
        .expect("chat row must still exist")
}
