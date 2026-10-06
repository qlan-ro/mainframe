use axum::body::to_bytes;

use super::*;
use mainframe_types::chat::{Chat, NewChat};

async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

async fn switch(
    ctx: &Arc<AppCtx>,
    id: &str,
    body: &'static [u8],
) -> (StatusCode, serde_json::Value) {
    read(
        switch_provider(
            State(ctx.clone()),
            Path(id.to_string()),
            Bytes::from_static(body),
        )
        .await,
    )
    .await
}

async fn setup() -> (Arc<AppCtx>, Chat) {
    std::fs::create_dir_all("/tmp/chat-switch-route").unwrap();
    let ctx = crate::ctx::AppCtx::test_ctx_with_chat_manager();
    ctx.adapter_registry
        .register(crate::chat_test_support::StubAdapter::new("claude", false));
    ctx.adapter_registry
        .register(crate::chat_test_support::StubAdapter::new("codex", false));
    ctx.adapter_registry.seed_static_snapshots();
    let project = ctx
        .db
        .call(|db| db.projects.create("/tmp/chat-switch-route", None))
        .await
        .unwrap();
    let chat = ctx
        .chat_manager
        .as_ref()
        .unwrap()
        .create_chat_with_defaults(
            NewChat {
                project_id: project.id.clone(),
                adapter_id: "claude".to_string(),
                ..Default::default()
            },
            None,
            None,
        )
        .await;
    (ctx, chat)
}

#[tokio::test]
async fn an_unknown_body_field_400s() {
    let ctx = AppCtx::test_ctx();
    let (status, _) = switch(&ctx, "c1", br#"{"adapterId":"codex","foo":1}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_bad_adapter_id_or_chat_id_400s() {
    let ctx = AppCtx::test_ctx();
    let (status, _) = switch(&ctx, "c1", br#"{"adapterId":"../codex"}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = switch(&ctx, "bad id!", br#"{"adapterId":"codex"}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = switch(&ctx, "c1", b"").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn an_unknown_chat_404s() {
    let ctx = AppCtx::test_ctx_with_chat_manager();
    let (status, body) = switch(&ctx, "nope", br#"{"adapterId":"codex"}"#).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Chat nope not found");
}

#[tokio::test]
async fn an_uninstalled_target_422s() {
    let (ctx, chat) = setup().await;
    let (status, body) = switch(&ctx, &chat.id, br#"{"adapterId":"codex"}"#).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"], "codex isn't installed");
}

#[tokio::test]
async fn segments_list_one_initial_segment_and_404_unknown_chats() {
    let (ctx, chat) = setup().await;
    let (status, body) = read(list_segments(State(ctx.clone()), Path(chat.id.clone())).await).await;
    assert_eq!(status, StatusCode::OK);
    let segments = body["data"].as_array().unwrap();
    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0]["kind"], "initial");
    assert_eq!(segments[0]["adapterId"], "claude");
    assert!(segments[0]["closedAt"].is_null());

    let (status, _) = read(list_segments(State(ctx.clone()), Path("nope".into())).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
