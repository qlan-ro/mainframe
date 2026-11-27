use super::*;
use crate::chat_test_support::StubAdapter;
use crate::{AppCtx, Db};
use mainframe_types::acp::jsonrpc::{JsonRpcOutcome, RequestId};
use mainframe_types::chat::ChatMessage;
use serde_json::json;
use std::sync::Arc;

fn message(n: usize) -> ChatMessage {
    serde_json::from_value(json!({"id":format!("m{n}"),"chatId":"c","type":"user",
        "timestamp":"2026-11-27T00:00:00Z","content":[{"type":"text","text":format!("message {n}")}]}))
    .unwrap()
}

/// 100 messages as five pages of 20, newest page first.
fn pages() -> Vec<Vec<ChatMessage>> {
    (0..5)
        .map(|page| ((4 - page) * 20..(5 - page) * 20).map(message).collect())
        .collect()
}

async fn context(pages: Option<Vec<Vec<ChatMessage>>>) -> (Arc<AppCtx>, String) {
    let directory = tempfile::tempdir().unwrap().keep();
    let db = Db::spawn(|| mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")))
        .unwrap();
    let ctx = Arc::new(
        AppCtx::test_builder(db, directory.join("data"))
            .build()
            .unwrap(),
    );
    ctx.core.adapter_registry.register(match pages {
        Some(pages) => StubAdapter::paged("codex", pages),
        None => StubAdapter::new("codex", false),
    });
    let path = directory.to_string_lossy().into_owned();
    let chat_id = ctx
        .core
        .db
        .call(move |db| {
            let project = db.projects.create(&path, None)?;
            let chat = db.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id,
                adapter_id: "codex".into(),
                ..Default::default()
            })?;
            db.chats.update(
                &chat.id,
                &mainframe_types::chat_patch::ChatPatch {
                    vendor_session_id: Some("thread".into()),
                    ..Default::default()
                },
            )?;
            Ok(chat.id)
        })
        .await
        .unwrap();
    (ctx, chat_id)
}

fn request(chat_id: &str) -> JsonRpcRequest {
    request_for(chat_id, json!({"containers":40}))
}

fn request_for(chat_id: &str, window: serde_json::Value) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(RequestId::Number(1)),
        method: "session/resume".into(),
        params: Some(json!({"sessionId":chat_id,
        "cwd":"/tmp", "replayFrom":{"type":"start"},
        "_meta":{"_mainframe.dev":{"window":window}}})),
    }
}

fn options() -> ResumeOptions {
    ResumeOptions {
        windowed_history: true,
        ..Default::default()
    }
}

#[tokio::test]
async fn an_uncached_open_answers_the_first_window_from_pages_and_says_older_turns_exist() {
    let (ctx, chat_id) = context(Some(pages())).await;

    let (response, replay) = ctx
        .chat
        .facade_hub
        .adapter_window_resume(&ctx.chat.chat_manager, &request(&chat_id), options(), None)
        .await
        .expect("the adapter pages");

    let JsonRpcOutcome::Result { result } = response.outcome else {
        panic!("resume failed");
    };
    let history = &result["_meta"]["_mainframe.dev"]["history"];
    assert_eq!(history["hasMore"], true);
    let ids: Vec<_> = replay
        .containers
        .iter()
        .flatten()
        .map(|i| i.id().to_string())
        .collect();
    assert!(ids.len() >= 40, "{}", ids.len());
    assert!(ids.last().unwrap().contains("m99"), "{ids:?}");
    assert_eq!(history["floorItemId"], ids[0]);
    assert!(
        ctx.chat.chat_manager.history_validation(&chat_id).is_none(),
        "a window built from pages is never offered for persistence"
    );
}

#[tokio::test]
async fn a_chat_whose_adapter_cannot_page_takes_the_normal_resume() {
    let (ctx, chat_id) = context(None).await;

    let window = ctx
        .chat
        .facade_hub
        .adapter_window_resume(&ctx.chat.chat_manager, &request(&chat_id), options(), None)
        .await;

    assert!(window.is_none());
}

#[tokio::test]
async fn a_connection_without_windowed_history_is_left_alone() {
    let (ctx, chat_id) = context(Some(pages())).await;
    let options = ResumeOptions {
        windowed_history: false,
        ..options()
    };

    let window = ctx
        .chat
        .facade_hub
        .adapter_window_resume(&ctx.chat.chat_manager, &request(&chat_id), options, None)
        .await;

    assert!(window.is_none());
}

#[tokio::test]
async fn a_first_window_by_turns_reads_pages_until_that_many_turns_exist() {
    let (ctx, chat_id) = context(Some(pages())).await;
    for (turns, wanted) in [(3, 3), (30, 30)] {
        let (_, replay) = ctx
            .chat
            .facade_hub
            .adapter_window_resume(
                &ctx.chat.chat_manager,
                &request_for(&chat_id, json!({ "turns": turns })),
                options(),
                None,
            )
            .await
            .expect("the adapter pages");
        let ids: Vec<_> = replay
            .containers
            .iter()
            .flatten()
            .map(|i| i.id().to_string())
            .collect();
        assert_eq!(ids.len(), wanted, "turns = {turns}");
        assert!(ids.last().unwrap().contains("m99"), "{ids:?}");
    }
}
