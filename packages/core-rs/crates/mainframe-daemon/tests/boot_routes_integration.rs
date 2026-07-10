//! Boot integration for the Task 5.5 surfaces: serves `build_app` over a fully
//! wired `AppCtx` (launch registry + LSP manager + plugin manager Some) and asserts
//! the happy paths of `/api/projects/:id/launch/status`, `/api/plugins`, and
//! `/api/lsp/languages`.
//!
//! Integration tests are only built under `cargo test`, so `unwrap`/`expect` are
//! permitted here (RUST RULES `#[cfg(test)]` exemption).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use dashmap::DashMap;
use mainframe_adapter_api::AdapterRegistry;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_db::DatabaseManager;
use mainframe_launch::{BroadcastFn, LaunchRegistry, TunnelManager};
use mainframe_lsp::{LspManager, LspRegistry};
use mainframe_plugins::event_bus::PublicDaemonBus;
use mainframe_plugins::manager::PluginManagerDeps;
use mainframe_plugins::{EmitSink, PluginContext, PluginError, PluginHostDb, PluginManager};
use mainframe_server::ctx::{AppCtx, GitFactory, Services};
use mainframe_server::db::Db;
use mainframe_server::{build_app, spawn_broadcast_pump};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_types::chat::{Chat, Project};
use mainframe_types::events::DaemonEvent;
use mainframe_types::plugin::PluginManifest;

/// The minimal `PluginHostDb` the wired PluginManager needs (unused by the listing
/// route, which reads only the loaded manifests + tracked panels/actions).
struct NullHostDb;

impl PluginHostDb for NullHostDb {
    fn chats_list(&self, _project_id: &str) -> Vec<Chat> {
        Vec::new()
    }
    fn chats_get(&self, _id: &str) -> Option<Chat> {
        None
    }
    fn chats_create(&self, _p: &str, _a: &str, _m: Option<&str>, _mode: Option<&str>) -> Chat {
        unreachable!("chats_create is not exercised by the listing route")
    }
    fn settings_get(&self, _category: &str, _key: &str) -> Option<String> {
        None
    }
    fn settings_set(&self, _category: &str, _key: &str, _value: &str) {}
    fn projects_list(&self) -> Vec<Project> {
        Vec::new()
    }
    fn projects_get(&self, _id: &str) -> Option<Project> {
        None
    }
}

async fn demo_plugin(_ctx: Arc<PluginContext>) -> Result<Router<()>, PluginError> {
    Ok(Router::new())
}

fn manifest(id: &str) -> PluginManifest {
    PluginManifest {
        id: id.into(),
        name: id.into(),
        version: "1.0.0".into(),
        description: None,
        author: None,
        license: None,
        capabilities: vec![],
        ui: None,
        adapter: None,
        commands: None,
    }
}

#[tokio::test]
async fn boot_serves_launch_plugins_and_lsp_happy_paths() {
    let data_dir = tempfile::tempdir().unwrap();
    let db = Db::spawn(|| DatabaseManager::open(std::path::Path::new(":memory:"))).unwrap();

    // Seed a project so the launch route resolves an effective path.
    let project = db
        .call(|d| d.projects.create("/tmp/boot-routes-test", Some("Boot")))
        .await
        .unwrap();
    let project_id = project.id.clone();

    let (broadcast, _keepalive) = tokio::sync::broadcast::channel::<DaemonEvent>(64);
    let watcher_tx = broadcast.clone();

    let noop_event: BroadcastFn = Arc::new(|_| {});
    let tunnel_manager = Arc::new(TunnelManager::new(Some(Arc::clone(&noop_event))));
    let launch_registry = Arc::new(LaunchRegistry::new(
        Arc::clone(&noop_event),
        Some(Arc::clone(&tunnel_manager)),
    ));
    let lsp_manager = Arc::new(LspManager::new(Arc::new(LspRegistry::new())));

    let emit: EmitSink = Arc::new(|_| {});
    let host_db: Arc<dyn PluginHostDb> = Arc::new(NullHostDb);
    let plugin_manager = Arc::new(PluginManager::new(PluginManagerDeps {
        host_db,
        daemon_bus: Arc::new(PublicDaemonBus::new()),
        emit,
        adapters: None,
    }));
    plugin_manager
        .load_builtin(manifest("demo"), data_dir.path().to_path_buf(), demo_plugin)
        .await
        .unwrap();

    let ctx = Arc::new(AppCtx {
        db,
        git: GitFactory,
        services: Services {
            attachments: Arc::new(AttachmentStore::new(data_dir.path().join("attachments"))),
            push: Arc::new(PushService::new()),
            watcher: Arc::new(FileWatcherService::new(move |event| {
                let _ = watcher_tx.send(event);
            })),
        },
        broadcast,
        data_dir: data_dir.path().to_path_buf(),
        version: "0.0.0-test".to_string(),
        port: 0,
        auth_secret: None,
        tunnel_url: Arc::new(std::sync::RwLock::new(None)),
        ws_clients: Arc::new(DashMap::new()),
        adapter_registry: Arc::new(AdapterRegistry::new()),
        background_tasks: Arc::new(BackgroundTaskTracker::new()),
        chat_manager: None,
        launch_registry: Some(Arc::clone(&launch_registry)),
        tunnel_manager: Some(Arc::clone(&tunnel_manager)),
        lsp_manager: Some(Arc::clone(&lsp_manager)),
        plugin_manager: Some(Arc::clone(&plugin_manager)),
    });
    spawn_broadcast_pump(Arc::clone(&ctx));

    let app = build_app(Arc::clone(&ctx));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        })
        .await
    });
    let base = format!("http://{addr}");

    // --- /api/projects/:id/launch/status ---
    let launch: serde_json::Value =
        reqwest::get(format!("{base}/api/projects/{project_id}/launch/status"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(launch["success"], true);
    assert_eq!(launch["data"]["effectivePath"], "/tmp/boot-routes-test");
    assert_eq!(launch["data"]["statuses"], serde_json::json!({}));

    // --- /api/plugins ---
    let plugins_resp = reqwest::get(format!("{base}/api/plugins")).await.unwrap();
    assert_eq!(plugins_resp.status(), reqwest::StatusCode::OK);
    let plugins: serde_json::Value = plugins_resp.json().await.unwrap();
    let list = plugins["plugins"].as_array().unwrap();
    assert!(
        list.iter().any(|p| p["id"] == "demo"),
        "expected the loaded builtin to be listed: {plugins}"
    );

    // --- /api/lsp/languages ---
    let lsp: serde_json::Value =
        reqwest::get(format!("{base}/api/lsp/languages?projectId={project_id}"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(lsp["success"], true);
    assert!(
        lsp["data"]["languages"].is_array(),
        "languages must be an array: {lsp}"
    );

    // A missing projectId is a 400 (Zod min(1)).
    let bad = reqwest::get(format!("{base}/api/lsp/languages"))
        .await
        .unwrap();
    assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);

    let _ = shutdown_tx.send(());
    server.await.unwrap().expect("server exits cleanly");
}
