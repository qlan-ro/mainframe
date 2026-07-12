//! Boot smoke test: assembles the same AppCtx the daemon's `main` builds (Db
//! actor + real services + broadcast + WS registry), serves `build_app` on an
//! ephemeral port with connect-info, and asserts `/health`'s wire shape, then
//! shuts down gracefully.
//!
//! Integration tests are only built under `cargo test`, so `unwrap`/`expect` are
//! permitted here (RUST RULES `#[cfg(test)]` exemption).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::net::SocketAddr;
use std::sync::Arc;

use dashmap::DashMap;
use mainframe_adapter_api::AdapterRegistry;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_db::DatabaseManager;
use mainframe_server::ctx::{AppCtx, GitFactory, Services};
use mainframe_server::db::Db;
use mainframe_server::{build_app, spawn_broadcast_pump};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_types::events::DaemonEvent;

#[tokio::test]
async fn health_endpoint_serves_expected_shape_and_shuts_down_gracefully() {
    let data_dir = tempfile::tempdir().unwrap();
    let db = Db::spawn(|| DatabaseManager::open(std::path::Path::new(":memory:"))).unwrap();
    let (broadcast, _keepalive) = tokio::sync::broadcast::channel::<DaemonEvent>(64);
    let watcher_tx = broadcast.clone();
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
        resolved_path: mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
        tunnel_url: Arc::new(std::sync::RwLock::new(None)),
        ws_clients: Arc::new(DashMap::new()),
        adapter_registry: Arc::new(AdapterRegistry::new()),
        background_tasks: Arc::new(BackgroundTaskTracker::new()),
        chat_manager: None,
        launch_registry: None,
        tunnel_manager: None,
        lsp_manager: None,
        plugin_manager: None,
        automations: None,
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

    let json: serde_json::Value = reqwest::get(format!("http://{addr}/health"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(json["status"], "ok");
    assert_eq!(json["version"], "0.0.0-test");
    assert!(json["tunnelUrl"].is_null());
    let ts = json["timestamp"].as_str().expect("timestamp is a string");
    assert!(ts.ends_with('Z'), "millis+Z ISO-8601: {ts}");
    assert_eq!(ts.len(), 24, "millis precision: {ts}");
    assert_eq!(&ts[19..20], ".");

    let _ = shutdown_tx.send(());
    server
        .await
        .unwrap()
        .expect("server task must exit cleanly after graceful shutdown");
}
