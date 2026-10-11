#![allow(clippy::unwrap_used, clippy::expect_used)]
use mainframe_launch::{TunnelConfig, TunnelManager};
use mainframe_server::{ctx::AppCtx, db::Db};
use mainframe_types::{chat::NewChat, chat_patch::ChatPatch, launch::LaunchConfiguration};
use serde_json::Value;
use std::{os::unix::fs::PermissionsExt, sync::Arc, time::Duration};

struct Fixture {
    tunnel_pid: u32,
    ctx: Arc<AppCtx>,
    url: String,
    project: String,
    chat: String,
    path: String,
    worktree: tempfile::TempDir,
    _data: tempfile::TempDir,
    _listener: std::net::TcpListener,
}

async fn fixture() -> Fixture {
    let data = tempfile::tempdir().unwrap();
    let worktree = tempfile::tempdir().unwrap();
    let path = worktree.path().to_string_lossy().into_owned();
    std::fs::write(worktree.path().join(".git"), "gitdir: unused").unwrap();
    let tunnels = tunnels(&data);
    let db = Db::spawn(|| mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")))
        .unwrap();
    let ctx = Arc::new(
        AppCtx::test_builder(db, data.path().into())
            .tunnel_manager(tunnels)
            .build()
            .unwrap(),
    );
    let project = ctx
        .core
        .db
        .call(|db| db.projects.create("/project", None))
        .await
        .unwrap()
        .id;
    let chat = create_chat(&ctx, &project, &path).await;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    start(&ctx, &project, &path, listener.local_addr().unwrap().port()).await;
    let url = serve(&ctx).await;
    let tunnel_pid = std::fs::read_to_string(data.path().join("tunnel.pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    Fixture {
        tunnel_pid,
        ctx,
        url,
        project,
        chat,
        path,
        worktree,
        _data: data,
        _listener: listener,
    }
}

async fn create_chat(ctx: &AppCtx, project: &str, path: &str) -> String {
    let project = project.to_owned();
    let path = path.to_owned();
    ctx.core
        .db
        .call(move |db| {
            let chat = db.chats.create(&NewChat {
                project_id: project,
                adapter_id: "claude".into(),
                ..Default::default()
            })?;
            db.chats.update(
                &chat.id,
                &ChatPatch {
                    worktree_path: Some(Some(path)),
                    ..Default::default()
                },
            )?;
            Ok(chat.id)
        })
        .await
        .unwrap()
}

async fn start(ctx: &AppCtx, project: &str, path: &str, port: u16) {
    ctx.infra
        .launch_registry
        .get_or_create(project, path)
        .start(&LaunchConfiguration {
            name: "web".into(),
            runtime_executable: "/bin/sh".into(),
            runtime_args: vec!["-c".into(), "exec sleep 100".into()],
            port: Some(port.into()),
            url: None,
            preview: Some(true),
            env: None,
        })
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while ctx.infra.tunnel_manager.get_url("preview:web").is_none() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn deleted_worktree_status_and_stop_reach_the_existing_launch_and_preview() {
    let f = fixture().await;
    f.worktree.close().unwrap();
    let base = format!("{}/api/projects/{}/launch", f.url, f.project);
    let response = reqwest::get(format!("{base}/status?chatId={}", f.chat))
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body: Value = response.json().await.unwrap();
    assert_eq!(body["data"]["effectivePath"], f.path);
    assert_eq!(body["data"]["statuses"]["web"], "running");
    assert!(body["data"]["tunnelUrls"]["web"].is_string());
    let response = reqwest::Client::new()
        .post(format!("{base}/web/stop?chatId={}", f.chat))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(f.ctx.infra.tunnel_manager.get_url("preview:web"), None);
    assert!(!mainframe_runtime::process::is_alive(f.tunnel_pid));
}

#[tokio::test]
async fn deletion_notification_stops_scope_launches_and_preview_tunnels() {
    let f = fixture().await;
    f.worktree.close().unwrap();
    f.ctx
        .chat
        .chat_manager
        .notify_worktree_deleted(&f.project, &f.path)
        .await;
    assert!(!mainframe_runtime::process::is_alive(f.tunnel_pid));
    assert_eq!(f.ctx.infra.tunnel_manager.get_url("preview:web"), None);
    let statuses = f
        .ctx
        .infra
        .launch_registry
        .get(&f.project, &f.path)
        .unwrap()
        .get_all_statuses();
    assert_eq!(serde_json::to_value(statuses).unwrap()["web"], "stopped");
}

#[tokio::test]
async fn deleted_worktree_start_and_configs_use_the_file_route_error_text() {
    let f = fixture().await;
    f.worktree.close().unwrap();
    let base = format!("{}/api/projects/{}/launch", f.url, f.project);
    let client = reqwest::Client::new();
    let requests = [
        client.get(format!("{base}/configs?chatId={}", f.chat)),
        client.post(format!("{base}/web/start?chatId={}", f.chat)),
    ];
    for request in requests {
        let response = request.send().await.unwrap();
        assert_eq!(response.status(), 404);
        assert_eq!(
            response.json::<Value>().await.unwrap()["error"],
            "Worktree missing"
        );
    }
    f.ctx
        .chat
        .chat_manager
        .notify_worktree_deleted(&f.project, &f.path)
        .await;
}

fn tunnels(data: &tempfile::TempDir) -> Arc<TunnelManager> {
    let script = data.path().join("cloudflared");
    std::fs::write(
        &script,
        format!("#!/bin/sh\necho $$ > '{}'\necho 'https://deleted-worktree.trycloudflare.com'\necho 'Registered tunnel connection'\nexec sleep 100\n", data.path().join("tunnel.pid").display()),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    Arc::new(TunnelManager::with_config(
        None,
        TunnelConfig {
            cloudflared_bin: script.to_string_lossy().into_owned(),
            dns_poll: Duration::from_millis(10),
            dns_timeout: Duration::from_millis(20),
            stop_grace: Duration::from_millis(100),
            ..Default::default()
        },
    ))
}

#[tokio::test]
async fn aliased_worktree_stop_reaches_launch_preview_and_port_tunnel_before_removal() {
    let f = fixture().await;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    f.ctx
        .infra
        .port_tunnels
        .start(
            port,
            mainframe_launch::PortTunnelScope {
                project_id: f.project.clone(),
                chat_id: f.chat.clone(),
            },
        )
        .await
        .unwrap();
    let port_pid: u32 = std::fs::read_to_string(f._data.path().join("tunnel.pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let alias = f._data.path().join("worktree-alias");
    std::os::unix::fs::symlink(&f.path, &alias).unwrap();
    let mut events = f.ctx.core.broadcast.subscribe();
    let affected = f
        .ctx
        .chat
        .chat_manager
        .stop_worktree_services(&f.project, &format!("{}/", alias.display()))
        .await
        .unwrap();
    assert_eq!(affected, vec![f.chat.clone()]);
    assert!(f.worktree.path().exists());
    assert!(!mainframe_runtime::process::is_alive(f.tunnel_pid));
    assert!(!mainframe_runtime::process::is_alive(port_pid));
    assert_eq!(
        f.ctx.infra.tunnel_manager.get_url(&format!("port:{port}")),
        None
    );
    while let Ok(event) = events.try_recv() {
        assert!(!matches!(
            event,
            mainframe_types::events::DaemonEvent::ChatUpdated { .. }
        ));
    }
    f.worktree.close().unwrap();
    f.ctx.chat.chat_manager.emit_chat_updated(&f.chat);
    let event = events.recv().await.unwrap();
    let mainframe_types::events::DaemonEvent::ChatUpdated { chat, .. } = event else {
        panic!("expected chat.updated after removal");
    };
    assert_eq!(chat.id, f.chat);
    assert_eq!(chat.worktree_missing, Some(true));
}

async fn serve(ctx: &Arc<AppCtx>) -> String {
    let http = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", http.local_addr().unwrap());
    let app = mainframe_server::build_app(ctx.clone());
    tokio::spawn(async move {
        axum::serve(
            http,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });
    url
}
