#![allow(clippy::unwrap_used, clippy::expect_used)]
mod support;

use mainframe_types::{chat::NewChat, chat_patch::ChatPatch};
use support::spawn_test_server;

#[tokio::test]
async fn deleted_worktree_refuses_every_file_route_before_io() {
    let server = spawn_test_server(None).await;
    let root = tempfile::tempdir().unwrap();
    let path = root.path().to_string_lossy().into_owned();
    let (project, chat) = server
        .ctx
        .core
        .db
        .call(move |db| {
            let project = db.projects.create(&path, None)?;
            let chat = db.chats.create(&NewChat {
                project_id: project.id.clone(),
                adapter_id: "claude".into(),
                ..Default::default()
            })?;
            db.chats.update(
                &chat.id,
                &ChatPatch {
                    worktree_path: Some(Some(format!("{path}/deleted"))),
                    ..Default::default()
                },
            )?;
            Ok((project, chat))
        })
        .await
        .unwrap();
    let client = reqwest::Client::new();
    for suffix in [
        "tree",
        "search/files",
        "search/content",
        "files-list",
        "files",
        "paths/resolve",
    ] {
        let url = server.http_url(&format!(
            "/api/projects/{}/{suffix}?chatId={}&path=README.md&q=readme",
            project.id, chat.id
        ));
        let response = client.get(url).send().await.unwrap();
        assert_eq!(response.status(), 404, "{suffix}");
        assert_eq!(
            response.text().await.unwrap(),
            r#"{"error":"Worktree missing","success":false}"#
        );
    }
    let response = client
        .put(server.http_url(&format!("/api/projects/{}/files", project.id)))
        .json(&serde_json::json!({"chatId":chat.id,"path":"README.md","content":"new"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 404);
    for (suffix, expected) in [("launch/status", 200), ("launch/configs", 404)] {
        let response = client
            .get(server.http_url(&format!(
                "/api/projects/{}/{suffix}?chatId={}",
                project.id, chat.id
            )))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{suffix}");
    }
    for (suffix, expected) in [("launch/dev/start", 404), ("launch/dev/stop", 200)] {
        let response = client
            .post(server.http_url(&format!(
                "/api/projects/{}/{suffix}?chatId={}",
                project.id, chat.id
            )))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{suffix}");
    }
    let response = client
        .get(server.http_url(&format!(
            "/lsp/{}/typescript?chatId={}",
            project.id, chat.id
        )))
        .header("connection", "upgrade")
        .header("upgrade", "websocket")
        .header("sec-websocket-version", "13")
        .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 404);
    assert!(!root.path().join("README.md").exists());
}
