#![allow(clippy::unwrap_used, clippy::expect_used)]
mod support;
use mainframe_types::{
    chat::NewChat,
    chat_patch::ChatPatch,
    events::DaemonEvent,
    launch::{LaunchConfiguration, LaunchProcessStatus},
};
use std::path::Path;

fn git(path: &Path, args: &[&str]) {
    let result = std::process::Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

struct Fixture {
    server: support::TestServer,
    repo: tempfile::TempDir,
    path: std::path::PathBuf,
    raw: String,
    project: mainframe_types::chat::Project,
    chat: mainframe_types::chat::Chat,
}

async fn fixture() -> Fixture {
    let server = support::spawn_test_server(None).await;
    let repo = tempfile::tempdir().unwrap();
    git(repo.path(), &["init", "-b", "main"]);
    git(
        repo.path(),
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "init",
        ],
    );
    let path = repo.path().join("wt");
    git(
        repo.path(),
        &["worktree", "add", "-b", "feature", path.to_str().unwrap()],
    );
    let alias = repo.path().join("alias");
    std::os::unix::fs::symlink(&path, &alias).unwrap();
    let raw = format!("{}/", alias.display());
    let project_path = repo.path().to_str().unwrap().to_owned();
    let project = server
        .ctx
        .core
        .db
        .call(move |db| db.projects.create(&project_path, None))
        .await
        .unwrap();
    let chat = bind_chat(&server, &project.id, &path).await;
    Fixture {
        server,
        repo,
        path,
        raw,
        project,
        chat,
    }
}

async fn bind_chat(
    server: &support::TestServer,
    project: &str,
    path: &Path,
) -> mainframe_types::chat::Chat {
    let project_id = project.to_owned();
    let worktree = path.to_str().unwrap().to_owned();
    server
        .ctx
        .core
        .db
        .call(move |db| {
            let chat = db.chats.create(&NewChat {
                project_id,
                adapter_id: "claude".into(),
                ..Default::default()
            })?;
            db.chats.update(
                &chat.id,
                &ChatPatch {
                    worktree_path: Some(Some(worktree)),
                    branch_name: Some(Some("feature".into())),
                    ..Default::default()
                },
            )?;
            Ok(chat)
        })
        .await
        .unwrap()
}

async fn start_alias_launch(
    server: &support::TestServer,
    project: &str,
    raw: &str,
    path: &Path,
    repo: &Path,
) -> (
    std::sync::Arc<mainframe_launch::LaunchManager>,
    std::path::PathBuf,
) {
    let stopped_while_present = repo.join("stopped-while-present");
    let ready = repo.join("launch-ready");
    let launch = server.ctx.infra.launch_registry.get_or_create(project, raw);
    launch
        .start(&LaunchConfiguration {
            name: "alias-only".into(),
            runtime_executable: "/bin/sh".into(),
            runtime_args: vec!["-c".into(), r#"trap 'test -d "$1" && printf present > "$2"; exit 0' TERM; printf ready > "$3"; while :; do sleep 1; done"#.into(), "launch".into(), path.to_string_lossy().into_owned(), stopped_while_present.to_string_lossy().into_owned(), ready.to_string_lossy().into_owned()],
            port: None,
            url: None,
            preview: None,
            env: None,
        })
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !ready.exists() {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    (launch, stopped_while_present)
}

#[tokio::test]
async fn delete_route_stops_unbound_alias_launch_before_removing_and_emitting() {
    let Fixture {
        server,
        repo,
        path,
        raw,
        project,
        chat,
    } = fixture().await;
    let (launch, stopped_while_present) =
        start_alias_launch(&server, &project.id, &raw, &path, repo.path()).await;
    let mut events = server.ctx.core.broadcast.subscribe();
    let response = reqwest::Client::new()
        .post(server.http_url(&format!("/api/projects/{}/git/delete-worktree", project.id)))
        .json(&serde_json::json!({"worktreePath": raw, "branchName": "feature"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200, "{}", response.text().await.unwrap());
    assert!(!path.exists());
    assert_eq!(
        std::fs::read_to_string(stopped_while_present).unwrap(),
        "present"
    );
    assert_eq!(
        launch.get_all_statuses().get("alias-only"),
        Some(&LaunchProcessStatus::Stopped)
    );
    let mut order = Vec::new();
    while let Ok(event) = events.try_recv() {
        match event {
            DaemonEvent::LaunchStatus {
                status: LaunchProcessStatus::Stopped,
                ..
            } => order.push("stop"),
            DaemonEvent::ChatUpdated { chat: updated, .. } if updated.id == chat.id => {
                assert_eq!(updated.worktree_missing, Some(true));
                order.push("removed-and-emitted");
            }
            _ => {}
        }
    }
    assert_eq!(order, ["stop", "removed-and-emitted"]);
}
