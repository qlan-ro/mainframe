use super::*;
use dashmap::DashMap;
use mainframe_db::DatabaseManager;
use mainframe_server::ctx::{AppCtx, GitFactory, Services};
use mainframe_server::db::Db;
use mainframe_services::{
    attachment::AttachmentStore, files::FileWatcherService, push::PushService,
};
use mainframe_types::events::DaemonEvent;
use std::path::Path;

pub(super) fn app(data_dir: &tempfile::TempDir, tunnels: Arc<TunnelManager>) -> axum::Router {
    let db = Db::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap();
    let (broadcast, _keepalive) = tokio::sync::broadcast::channel::<DaemonEvent>(1024);
    let watcher_tx = broadcast.clone();
    let watcher = FileWatcherService::new(move |event| {
        let _ = watcher_tx.send(event);
    });
    let ctx = Arc::new(AppCtx {
        db,
        git: GitFactory,
        services: Services {
            attachments: Arc::new(AttachmentStore::new(data_dir.path().join("attachments"))),
            push: Arc::new(PushService::new()),
            watcher: Arc::new(watcher),
        },
        broadcast,
        adapter_registry: Arc::new(mainframe_adapter_api::AdapterRegistry::new()),
        background_tasks: Arc::new(
            mainframe_background_tasks::tracker::BackgroundTaskTracker::new(),
        ),
        claude_workflows: Arc::new(mainframe_claude_workflows::store::ClaudeWorkflowStore::new()),
        chat_manager: None,
        launch_registry: None,
        tunnel_manager: Some(tunnels),
        port_tunnels: None,
        lsp_manager: None,
        plugin_manager: None,
        automations: None,
        orchestration: None,
        quota: None,
        data_dir: data_dir.path().to_path_buf(),
        version: "0.0.0-test".to_string(),
        port: 31415,
        auth_secret: None,
        resolved_path: mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
        tunnel_url: Arc::new(std::sync::RwLock::new(None)),
        ws_clients: Arc::new(DashMap::new()),
        facade_hub: Arc::new(mainframe_server::FacadeHub::default()),
        facade_heartbeat_interval_ms: 1000,
    });
    mainframe_server::routes::tunnel::router().with_state(ctx)
}

pub(super) fn tunnels(
    dir: &tempfile::TempDir,
    registered: bool,
) -> (Arc<TunnelManager>, std::path::PathBuf) {
    let pid_file = dir.path().join("pid");
    let script = dir.path().join("cloudflared");
    let readiness = if registered {
        "echo 'Registered tunnel connection'"
    } else {
        ""
    };
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\ntrap '' TERM\necho $$ > '{}'\n{readiness}\nexec sleep 30\n",
            pid_file.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let tunnels = Arc::new(TunnelManager::with_config(
        None,
        TunnelConfig {
            cloudflared_bin: script.to_string_lossy().into_owned(),
            ..TunnelConfig::default()
        },
    ));
    (tunnels, pid_file)
}

pub(super) async fn wait_for_pid(path: &std::path::Path) -> i64 {
    timeout(Duration::from_secs(3), async {
        loop {
            if let Ok(text) = tokio::fs::read_to_string(path).await
                && let Ok(pid) = text.trim().parse::<i64>()
            {
                break pid;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

pub(super) async fn wait_for_phase(tunnels: &TunnelManager, registered: bool) {
    if registered {
        timeout(Duration::from_secs(3), async {
            while tunnels.get_url("daemon").is_none() {
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    } else {
        assert!(tunnels.get_url("daemon").is_none());
    }
}

pub(super) fn request(
    url: String,
) -> tokio::task::JoinHandle<Result<reqwest::Response, reqwest::Error>> {
    tokio::spawn(async move {
        reqwest::Client::new().post(url)
            .json(&serde_json::json!({"token": "test-placeholder", "url": "https://shutdown-test.invalid"}))
            .send().await
    })
}

pub(super) fn assert_pid_gone(pid: i64) {
    let pid = u32::try_from(pid).expect("registry pids are positive");
    assert!(
        !mainframe_runtime::process::is_alive(pid),
        "tunnel child survived shutdown"
    );
}
