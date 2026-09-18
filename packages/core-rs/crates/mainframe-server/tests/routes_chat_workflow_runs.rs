//! Regression net for a router losing this route (todo #350 follow-up): the
//! e2e run that surfaced this bug used daemon binaries built before commit
//! 48f739a7 registered `GET /api/chats/{id}/workflow-runs` — the route itself
//! was never missing from source, only from those stale artifacts. This test
//! is the oracle that would have caught it.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use reqwest::StatusCode;
use support::spawn_test_server;

#[tokio::test]
async fn succeeds_with_an_empty_list_for_a_chat_with_no_recorded_runs() {
    let server = spawn_test_server(None).await;

    let resp = reqwest::get(server.http_url("/api/chats/no-such-chat/workflow-runs"))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["data"], serde_json::json!([]));
    assert_eq!(body["success"], serde_json::json!(true));
}

#[tokio::test]
async fn succeeds_for_a_real_chat_row_with_no_claude_session_yet() {
    let server = spawn_test_server(None).await;
    let project_id = server.create_project("/tmp/wf-runs-project").await;
    let chat_id = server
        .ctx
        .db
        .call({
            let project_id = project_id.clone();
            move |db| db.chats.create(&project_id, "claude", None, None, None)
        })
        .await
        .unwrap()
        .id;

    let resp = reqwest::get(server.http_url(&format!("/api/chats/{chat_id}/workflow-runs")))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["data"], serde_json::json!([]));
    assert_eq!(body["success"], serde_json::json!(true));
}
