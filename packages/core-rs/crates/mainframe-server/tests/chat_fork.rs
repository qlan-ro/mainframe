//! `POST /api/chats/{id}/fork` (todo #343 Group 3, plan item 6) driven over a
//! real HTTP server against the production stack (`build_chat_manager` +
//! `build_app`), with `mainframe-adapter-mock`'s `MockCliAdapter` standing in
//! for a real fork-capable CLI (`with_fork_capable`, todo #343's mock seam).
//! `workflow_runs_history.rs`'s harness pattern.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use mainframe_adapter_api::AdapterRegistry;
use mainframe_adapter_mock::MockCliAdapter;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_db::DatabaseManager;
use mainframe_db::chats::ChatUpdate;
use mainframe_server::ctx::{AppCtx, Services};
use mainframe_server::{
    Db, GitFactory, build_app, build_chat_manager, chat_seams::NoopLaunchStopper,
    chat_seams::NoopScopeTunnelStopper, spawn_broadcast_pump,
};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_services::quota::{QuotaManager, QuotaManagerDeps, QuotaSettingsStore};
use mainframe_types::chat::ProcessState;
use mainframe_types::events::DaemonEvent;
use serde_json::Value;
use tempfile::TempDir;
use tokio::net::TcpListener;

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
    addr: SocketAddr,
    chat_id: String,
    db: Db,
    _data_dir: TempDir,
}

/// `fork_capable` mirrors `MockCliAdapter::with_fork_capable` (default `false`,
/// like Codex today); `update` lets each scenario set the fields `fork_chat`'s
/// eligibility checks gate on before the server ever answers a request.
async fn harness(fork_capable: bool, update: ChatUpdate) -> Harness {
    let data_dir = tempfile::tempdir().unwrap();
    let db = Db::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap();
    let (broadcast, _keepalive) = tokio::sync::broadcast::channel::<DaemonEvent>(64);
    let watcher_tx = broadcast.clone();
    let watcher = FileWatcherService::new(move |event| {
        let _ = watcher_tx.send(event);
    });
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let workflows = Arc::new(ClaudeWorkflowStore::new());
    let attachments = Arc::new(AttachmentStore::new(data_dir.path().join("attachments")));
    let push = Arc::new(PushService::new());
    let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings: Box::new(NoopQuotaSettings),
        emit_event: Box::new(|_| {}),
        now: None,
    }));

    let project_path = data_dir.path().to_string_lossy().into_owned();
    let project = db
        .call_blocking(move |d| d.projects.create(&project_path, None))
        .unwrap();
    let chat = db
        .call_blocking({
            let project_id = project.id.clone();
            move |d| {
                d.chats.create(&mainframe_types::chat::NewChat {
                    project_id,
                    adapter_id: "mock-cli".to_string(),
                    ..Default::default()
                })
            }
        })
        .unwrap();
    db.call_blocking({
        let chat_id = chat.id.clone();
        move |d| d.chats.update(&chat_id, &update)
    })
    .unwrap();

    let registry = Arc::new(AdapterRegistry::new());
    registry.register(Arc::new(
        MockCliAdapter::default().with_fork_capable(fork_capable),
    ));

    let manager = build_chat_manager(
        db.clone(),
        Arc::clone(&registry),
        Arc::clone(&tracker),
        Arc::clone(&attachments),
        Arc::clone(&push),
        GitFactory,
        broadcast.clone(),
        Arc::new(NoopLaunchStopper),
        Arc::new(NoopScopeTunnelStopper),
        quota,
        Arc::clone(&workflows),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
        None,
        data_dir.path().to_path_buf(),
    );

    let ctx = Arc::new(AppCtx {
        db: db.clone(),
        git: GitFactory,
        services: Services {
            attachments,
            push,
            watcher: Arc::new(watcher),
        },
        broadcast,
        adapter_registry: registry,
        background_tasks: tracker,
        claude_workflows: workflows,
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
        facade_hub: Arc::new(mainframe_server::FacadeHub::default()),
        facade_heartbeat_interval_ms: mainframe_acp::DEFAULT_HEARTBEAT_INTERVAL_MS,
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

    Harness {
        addr,
        chat_id: chat.id,
        db,
        _data_dir: data_dir,
    }
}

impl Harness {
    fn url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }

    async fn fork(&self, id: &str, body: &str) -> reqwest::Response {
        reqwest::Client::new()
            .post(self.url(&format!("/api/chats/{id}/fork")))
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .unwrap()
    }

    fn chat_count(&self) -> usize {
        self.db.call_blocking(|d| d.chats.list_all()).unwrap().len()
    }
}

fn with_session() -> ChatUpdate {
    ChatUpdate {
        claude_session_id: Some("parent-session".to_string()),
        ..Default::default()
    }
}

#[tokio::test]
async fn success_returns_ok_with_the_parent_reference() {
    let h = harness(true, with_session()).await;
    let before = h.chat_count();

    let resp = h.fork(&h.chat_id, "{}").await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["success"], true);
    assert_eq!(body["data"]["parentChatId"], h.chat_id);
    assert_eq!(h.chat_count(), before + 1);
}

/// An empty body (no `Content-Type`/bytes at all) is also accepted —
/// `parse_body` treats a whitespace-only body as `{}`.
#[tokio::test]
async fn an_empty_body_is_also_accepted() {
    let h = harness(true, with_session()).await;
    let resp = h.fork(&h.chat_id, "").await;
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn an_adapter_without_fork_capability_returns_422_naming_the_adapter() {
    let h = harness(false, with_session()).await;
    let before = h.chat_count();

    let resp = h.fork(&h.chat_id, "{}").await;
    assert_eq!(resp.status(), 422);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["success"], false);
    assert!(body["error"].as_str().unwrap().contains("Mock CLI"));
    assert_eq!(h.chat_count(), before);
}

#[tokio::test]
async fn no_provider_session_returns_409() {
    let h = harness(true, ChatUpdate::default()).await;
    let before = h.chat_count();

    let resp = h.fork(&h.chat_id, "{}").await;
    assert_eq!(resp.status(), 409);
    assert_eq!(h.chat_count(), before);
}

#[tokio::test]
async fn a_missing_transcript_returns_409() {
    let h = harness(
        true,
        ChatUpdate {
            transcript_missing: Some(true),
            ..with_session()
        },
    )
    .await;
    let before = h.chat_count();

    let resp = h.fork(&h.chat_id, "{}").await;
    assert_eq!(resp.status(), 409);
    assert_eq!(h.chat_count(), before);
}

#[tokio::test]
async fn a_missing_working_directory_returns_409() {
    let h = harness(
        true,
        ChatUpdate {
            worktree_path: Some(Some("/definitely/does/not/exist/todo-343".to_string())),
            ..with_session()
        },
    )
    .await;
    let before = h.chat_count();

    let resp = h.fork(&h.chat_id, "{}").await;
    assert_eq!(resp.status(), 409);
    assert_eq!(h.chat_count(), before);
}

#[tokio::test]
async fn a_turn_in_flight_returns_409() {
    let h = harness(
        true,
        ChatUpdate {
            process_state: Some(Some(ProcessState::Working)),
            ..with_session()
        },
    )
    .await;
    let before = h.chat_count();

    let resp = h.fork(&h.chat_id, "{}").await;
    assert_eq!(resp.status(), 409);
    assert_eq!(h.chat_count(), before);
}

#[tokio::test]
async fn an_unknown_chat_id_returns_404() {
    let h = harness(true, with_session()).await;
    let resp = h.fork("no-such-chat", "{}").await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn an_unknown_body_field_returns_400() {
    let h = harness(true, with_session()).await;
    let before = h.chat_count();

    let resp = h.fork(&h.chat_id, r#"{"unexpected":true}"#).await;
    assert_eq!(resp.status(), 400);
    assert_eq!(h.chat_count(), before);
}
