//! `Arc<AppCtx>` test constructors (todo #346 review fix), split out of
//! `chat_test_support`'s `StubAdapter`/`StubSession` scaffolding to keep that
//! sibling file under 300 lines. Backs `AppCtx::test_ctx` and
//! `AppCtx::test_ctx_with_chat_manager` — see those doc comments in `ctx.rs`.
#![cfg(test)]

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::RwLock;

use dashmap::DashMap;
use mainframe_adapter_api::AdapterRegistry;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_chat::chat_manager::ChatManager;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_runtime::ResolvedPath;
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use crate::acp_ws::FacadeHub;
use crate::ctx::{AppCtx, GitFactory, Services};
use crate::db::Db;

/// Shared `AppCtx` literal for [`test_ctx`] and [`test_ctx_with_chat_manager`]
/// — the two only ever differed in `db`/`broadcast`/`adapter_registry`/
/// `chat_manager`/`data_dir` (todo #346 review fix: this used to be
/// duplicated across both constructors).
fn test_ctx_from(
    db: Db,
    broadcast: broadcast::Sender<DaemonEvent>,
    adapter_registry: Arc<AdapterRegistry>,
    chat_manager: Option<Arc<ChatManager>>,
    data_dir: PathBuf,
) -> Arc<AppCtx> {
    let watcher = FileWatcherService::new(|_| {});
    Arc::new(AppCtx {
        db,
        git: GitFactory,
        services: Services {
            attachments: Arc::new(AttachmentStore::new(data_dir.join("attachments"))),
            push: Arc::new(PushService::new()),
            watcher: Arc::new(watcher),
        },
        broadcast,
        adapter_registry,
        background_tasks: Arc::new(BackgroundTaskTracker::new()),
        claude_workflows: Arc::new(ClaudeWorkflowStore::new()),
        chat_manager,
        launch_registry: None,
        tunnel_manager: None,
        port_tunnels: None,
        lsp_manager: None,
        plugin_manager: None,
        automations: None,
        quota: None,
        data_dir,
        version: "0.0.0-test".into(),
        port: 0,
        auth_secret: None,
        resolved_path: ResolvedPath::from_value("/usr/bin:/bin"),
        tunnel_url: Arc::new(RwLock::new(None)),
        ws_clients: Arc::new(DashMap::new()),
        facade_hub: Arc::new(FacadeHub::default()),
        facade_heartbeat_interval_ms: mainframe_acp::DEFAULT_HEARTBEAT_INTERVAL_MS,
    })
}

/// Build a fully-real `Arc<AppCtx>` for route unit tests over an in-memory DB
/// and real service collaborators (no mocks), with `chat_manager: None` — the
/// same surface the integration harness assembles. Route tests seed via
/// `ctx.db` and call handlers directly.
pub(crate) fn test_ctx() -> Arc<AppCtx> {
    use mainframe_db::DatabaseManager;

    let db = Db::spawn(|| DatabaseManager::open(std::path::Path::new(":memory:")))
        .expect("open in-memory db");
    let (broadcast, keep) = broadcast::channel::<DaemonEvent>(64);
    std::mem::forget(keep);
    test_ctx_from(
        db,
        broadcast,
        Arc::new(AdapterRegistry::new()),
        None,
        std::env::temp_dir().join("mf-routes-test"),
    )
}

/// Like [`test_ctx`], but with a REAL `ChatManager` (via `build_chat_manager`,
/// the same production `DaemonChatDeps` the daemon boot wires) so route tests
/// can reach the create/discard/archive/unarchive/remove-project success
/// paths those routes gate on `chat_manager` being `Some` (todo #346, AC 26)
/// — [`test_ctx`]'s `chat_manager: None` can only reach each route's
/// "unavailable" fallback. Register an adapter on the returned ctx's
/// `adapter_registry` before creating a chat under its id (see
/// `super::StubAdapter`).
pub(crate) fn test_ctx_with_chat_manager() -> Arc<AppCtx> {
    use mainframe_db::DatabaseManager;
    use mainframe_services::quota::{QuotaManager, QuotaManagerDeps, QuotaSettingsStore};

    use crate::chat_seams::{NoopLaunchStopper, NoopScopeTunnelStopper};

    struct NoopQuotaSettings;
    impl QuotaSettingsStore for NoopQuotaSettings {
        fn get(&self, _category: &str, _key: &str) -> Option<String> {
            None
        }
        fn get_by_category(&self, _category: &str) -> std::collections::HashMap<String, String> {
            std::collections::HashMap::new()
        }
        fn set(&self, _category: &str, _key: &str, _value: &str) {}
    }

    let db = Db::spawn(|| DatabaseManager::open(std::path::Path::new(":memory:")))
        .expect("open in-memory db");
    let (broadcast, keep) = broadcast::channel::<DaemonEvent>(64);
    std::mem::forget(keep);
    let adapter_registry = Arc::new(AdapterRegistry::new());
    let data_dir = std::env::temp_dir().join(format!("mf-routes-cm-test-{}", nanoid::nanoid!()));
    let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings: Box::new(NoopQuotaSettings),
        emit_event: Box::new(|_| {}),
        now: None,
    }));
    let manager = crate::chat_deps::build_chat_manager(
        db.clone(),
        adapter_registry.clone(),
        Arc::new(BackgroundTaskTracker::new()),
        Arc::new(AttachmentStore::new(data_dir.join("attachments"))),
        Arc::new(PushService::new()),
        GitFactory,
        broadcast.clone(),
        Arc::new(NoopLaunchStopper),
        Arc::new(NoopScopeTunnelStopper),
        quota,
        Arc::new(ClaudeWorkflowStore::new()),
        ResolvedPath::from_value("/usr/bin:/bin"),
        None,
        data_dir.clone(),
    );
    test_ctx_from(db, broadcast, adapter_registry, Some(manager), data_dir)
}
