use super::*;
use mainframe_types::chat::NewChat;

use crate::test_support::read_json as read;

#[tokio::test]
async fn discard_404s_for_an_unknown_chat() {
    let ctx = AppCtx::test_ctx();
    let (status, body) = read(discard(State(ctx.clone()), Path("nope".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Chat not found");
}

#[tokio::test]
async fn discard_refuses_a_non_temporary_chat() {
    let ctx = AppCtx::test_ctx();
    let project = ctx
        .core
        .db
        .call(|db| db.projects.create("/tmp/discard-not-temp", None))
        .await
        .unwrap();
    let chat = ctx
        .core
        .db
        .call(move |db| {
            db.chats.create(&NewChat {
                project_id: project.id,
                adapter_id: "claude".to_string(),
                ..Default::default()
            })
        })
        .await
        .unwrap();

    let (status, body) = read(discard(State(ctx.clone()), Path(chat.id)).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "chat is not temporary");
}

fn test_chat(temporary: bool) -> Chat {
    let mut chat = Chat::unpersisted(&NewChat {
        project_id: "p1".to_string(),
        adapter_id: "claude".to_string(),
        temporary,
        ..Default::default()
    });
    chat.id = "c1".to_string();
    chat
}

#[test]
fn refuse_if_temporary_is_none_for_a_normal_chat() {
    assert!(refuse_if_temporary(&test_chat(false), "pin").is_none());
}

#[test]
fn refuse_if_temporary_fails_for_a_temporary_chat() {
    assert!(refuse_if_temporary(&test_chat(true), "pin").is_some());
}

// ── discard success (needs a real ChatManager) ───────────────────────────

#[tokio::test]
async fn discard_deletes_the_row_and_scratch_dir_and_404s_on_the_next_get() {
    let ctx = AppCtx::test_ctx();
    ctx.core
        .adapter_registry
        .register(crate::chat_test_support::StubAdapter::new("claude", false));
    let created = ctx
        .chat
        .chat_manager
        .as_ref()
        .create_chat_with_defaults(
            NewChat {
                project_id: mainframe_types::chat::NO_PROJECT_ID.to_string(),
                adapter_id: "claude".to_string(),
                temporary: true,
                ..Default::default()
            },
            None,
            None,
        )
        .await
        .unwrap();
    let chat_id = created.id;

    let scratch_path = ctx
        .core
        .db
        .call({
            let chat_id = chat_id.clone();
            move |db| Ok(db.chats.get(&chat_id)?.and_then(|c| c.scratch_path))
        })
        .await
        .unwrap()
        .expect("a temporary non-project chat has a scratch path");
    std::fs::create_dir_all(&scratch_path).unwrap();
    assert!(std::path::Path::new(&scratch_path).exists());

    let (status, _) = read(discard(State(ctx.clone()), Path(chat_id.clone())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);

    assert!(
        !std::path::Path::new(&scratch_path).exists(),
        "the scratch directory must be removed"
    );
    let lookup = chat_id.clone();
    assert!(
        ctx.core
            .db
            .call(move |db| db.chats.get(&lookup))
            .await
            .unwrap()
            .is_none(),
        "the row must be deleted"
    );

    let (status, body) =
        read(crate::routes::chats::get_one(State(ctx.clone()), Path(chat_id)).await)
            .await
            .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Chat not found");
}
