use super::*;
use axum::http::StatusCode;
use mainframe_types::chat::NewChat;
use mainframe_types::chat_patch::ChatPatch;

use crate::test_support::read_json as read;

async fn seed_chat(ctx: &Arc<AppCtx>, adapter_id: &str, vendor_session_id: Option<&str>) -> String {
    let adapter_id = adapter_id.to_string();
    let project = ctx
        .core
        .db
        .call(|db| db.projects.create("/tmp/native-session-unarchive", None))
        .await
        .unwrap();
    let chat = ctx
        .core
        .db
        .call(move |db| {
            db.chats.create(&NewChat {
                project_id: project.id,
                adapter_id,
                ..Default::default()
            })
        })
        .await
        .unwrap();
    if let Some(session) = vendor_session_id {
        let (id, session) = (chat.id.clone(), session.to_string());
        ctx.core
            .db
            .call(move |db| {
                db.chats.update(
                    &id,
                    &ChatPatch {
                        vendor_session_id: Some(session),
                        ..Default::default()
                    },
                )
            })
            .await
            .unwrap();
    }
    chat.id
}

#[tokio::test]
async fn unarchive_404s_for_an_unknown_chat() {
    let ctx = AppCtx::test_ctx();
    let (status, body) = read(unarchive(State(ctx.clone()), Path("nope".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Chat not found");
}

#[tokio::test]
async fn unarchive_refuses_a_chat_that_never_started_a_provider_session() {
    let ctx = AppCtx::test_ctx();
    let id = seed_chat(&ctx, "codex", None).await;
    let (status, body) = read(unarchive(State(ctx.clone()), Path(id)).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        body["error"],
        "This chat has no provider session to unarchive"
    );
}

#[tokio::test]
async fn unarchive_refuses_an_adapter_without_the_remedy() {
    let ctx = AppCtx::test_ctx();
    let id = seed_chat(&ctx, "no-such-adapter", Some("thread-1")).await;
    let (status, body) = read(unarchive(State(ctx.clone()), Path(id)).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "this adapter cannot unarchive a session");
}
