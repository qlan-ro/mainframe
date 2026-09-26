//! A `TestServer` with a REAL `ChatManager` wired as `ctx.chat_manager` and
//! the facade hub as its chat surface (todo #350, plan group 1 step 0) — the
//! fixture `acp_ws_integration.rs`'s live-wiring tests need, since the plain
//! `spawn_test_server` harness runs with `chat_manager: None`. Mirrors
//! `chat_background_activity.rs`'s harness, plus the facade hub and a
//! pre-created project/chat so a test can prompt a real session immediately.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use mainframe_adapter_api::{Adapter, AdapterRegistry};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_db::DatabaseManager;
use mainframe_server::chat_seams::{NoopLaunchStopper, NoopScopeTunnelStopper};
use mainframe_server::ctx::{AppCtx, GitFactory, Services};
use mainframe_server::db::Db;
use mainframe_server::{build_app, build_chat_manager, spawn_broadcast_pump};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_services::quota::{QuotaManager, QuotaManagerDeps, QuotaSettingsStore};
use mainframe_types::events::DaemonEvent;
use tokio::net::TcpListener;

use super::TestServer;

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

/// A live facade session ready to drive: `chat_id` belongs to a real project
/// row, and `profile` is the adapter id its `/acp/{profile}` route serves.
pub struct FacadeServer {
    pub server: TestServer,
    pub chat_id: String,
    pub profile: String,
    pub project_id: String,
}

impl FacadeServer {
    /// A second chat under the same project/adapter — T10's cold-start-vs-
    /// cancel ordering test needs two independent sessions.
    pub async fn create_chat(&self) -> String {
        let project_id = self.project_id.clone();
        let profile = self.profile.clone();
        self.server
            .ctx
            .db
            .call(move |d| {
                d.chats.create(&mainframe_types::chat::NewChat {
                    project_id,
                    adapter_id: profile,
                    ..Default::default()
                })
            })
            .await
            .unwrap()
            .id
    }
}

/// `adapter` is injected (not hardcoded to the mock) so T10's barrier
/// adapter can reuse this fixture without a second harness.
pub async fn spawn_facade_server(adapter: Arc<dyn Adapter>) -> FacadeServer {
    spawn_facade_server_with(adapter, mainframe_acp::DEFAULT_HEARTBEAT_INTERVAL_MS).await
}

/// `heartbeat_interval_ms` shrinks the cadence so a test can observe several
/// ticks inside a bounded timeout (T10: proof the socket loop is not stuck
/// on a blocked prompt).
pub async fn spawn_facade_server_with(
    adapter: Arc<dyn Adapter>,
    heartbeat_interval_ms: u64,
) -> FacadeServer {
    let profile = adapter.id().to_string();
    let data_dir = tempfile::tempdir().unwrap();
    let db = Db::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap();
    let (broadcast, _keepalive) = tokio::sync::broadcast::channel::<DaemonEvent>(1024);
    let watcher_tx = broadcast.clone();
    let watcher = FileWatcherService::new(move |event| {
        let _ = watcher_tx.send(event);
    });
    let adapter_registry = Arc::new(AdapterRegistry::new());
    adapter_registry.register(adapter);
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let facade_hub = Arc::new(mainframe_server::FacadeHub::default());
    let quota_tx = broadcast.clone();
    let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings: Box::new(NoopQuotaSettings),
        emit_event: Box::new(move |event| {
            let _ = quota_tx.send(event);
        }),
        now: None,
    }));

    let manager = build_chat_manager(
        db.clone(),
        Arc::clone(&adapter_registry),
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
        Some(facade_hub.as_chat_surface()),
        data_dir.path().to_path_buf(),
    );

    let path = data_dir.path().to_string_lossy().into_owned();
    let project = db
        .call_blocking(move |d| d.projects.create(&path, None))
        .unwrap();
    let project_id = project.id.clone();
    let profile_for_chat = profile.clone();
    let chat = db
        .call_blocking(move |d| {
            d.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id,
                adapter_id: profile_for_chat,
                ..Default::default()
            })
        })
        .unwrap();

    let ctx = Arc::new(AppCtx {
        db,
        git: GitFactory,
        services: Services {
            attachments: Arc::new(AttachmentStore::new(data_dir.path().join("attachments"))),
            push: Arc::new(PushService::new()),
            watcher: Arc::new(watcher),
        },
        broadcast,
        adapter_registry,
        background_tasks: tracker,
        claude_workflows: Arc::new(ClaudeWorkflowStore::new()),
        chat_manager: Some(manager),
        launch_registry: None,
        tunnel_manager: None,
        port_tunnels: None,
        lsp_manager: None,
        plugin_manager: None,
        automations: None,
        quota: None,
        data_dir: data_dir.path().to_path_buf(),
        version: "0.0.0-test".to_string(),
        port: 0,
        auth_secret: None,
        resolved_path: mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
        tunnel_url: Arc::new(std::sync::RwLock::new(None)),
        ws_clients: Arc::new(DashMap::new()),
        facade_hub,
        facade_heartbeat_interval_ms: heartbeat_interval_ms,
    });
    spawn_broadcast_pump(Arc::clone(&ctx));

    let app = build_app(Arc::clone(&ctx));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let served = ctx.clone();
    tokio::spawn(async move {
        let _ = served;
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
    });
    tokio::time::sleep(Duration::from_millis(20)).await;

    FacadeServer {
        server: TestServer {
            addr,
            ctx,
            data_dir,
        },
        chat_id: chat.id,
        profile,
        project_id,
    }
}

/// One chat-surface revision for `chat_id`, pushed straight at the hub by the
/// tests that check who is (and is not) subscribed to a session's fan-out.
pub fn revision_event(chat_id: &str, text: &str) -> mainframe_chat::chat_surface::ChatSurfaceEvent {
    mainframe_chat::chat_surface::ChatSurfaceEvent::DisplayRevision {
        chat_id: chat_id.to_string(),
        messages: vec![mainframe_types::display::DisplayMessage {
            id: "m1".to_string(),
            chat_id: chat_id.to_string(),
            r#type: mainframe_types::display::DisplayMessageType::Assistant,
            content: vec![mainframe_types::display::DisplayContent::Leaf(
                mainframe_types::content::LeafContent::Text {
                    text: text.to_string(),
                    parent_tool_use_id: None,
                },
            )],
            timestamp: "2026-09-14T00:00:00.000Z".to_string(),
            metadata: None,
        }],
    }
}
