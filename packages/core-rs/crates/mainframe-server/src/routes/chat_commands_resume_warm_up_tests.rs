//! The viewing warm-up (`waitFor=transcript&initialWindow=true`): which opens it
//! leaves to the paged first window, and which still get the full restore.
use super::*;
use crate::Db;
use crate::chat_test_support::{StubAdapter, StubHistory};
use mainframe_acp::ResumeOptions;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, RequestId};
use mainframe_types::chat::{ChatMessage, ProcessState};
use mainframe_types::chat_patch::ChatPatch;
use serde_json::json;
use std::path::PathBuf;

fn message(n: usize) -> ChatMessage {
    serde_json::from_value(json!({"id":format!("m{n}"),"chatId":"c","type":"user",
        "timestamp":"2026-11-28T00:00:00Z","content":[{"type":"text","text":format!("message {n}")}]}))
    .unwrap()
}

/// 60 messages in three pages, newest first.
fn pages() -> Vec<Vec<ChatMessage>> {
    (0..3)
        .map(|page| ((2 - page) * 20..(3 - page) * 20).map(message).collect())
        .collect()
}

struct Fixture {
    ctx: Arc<AppCtx>,
    chat_id: String,
    db: Db,
    data: PathBuf,
}

fn context(db: Db, data: PathBuf, history: Arc<StubHistory>) -> Arc<AppCtx> {
    let ctx = Arc::new(AppCtx::test_builder(db, data).build().unwrap());
    ctx.core
        .adapter_registry
        .register(StubAdapter::with_history("codex", history));
    ctx
}

/// An idle chat nothing has cached, on a stub adapter with `history`.
async fn chat_with(history: Arc<StubHistory>, patch: ChatPatch) -> Fixture {
    let directory = tempfile::tempdir().unwrap().keep();
    let db = Db::spawn(|| mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")))
        .unwrap();
    let data = directory.join("data");
    let ctx = context(db.clone(), data.clone(), history);
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
            let patch = ChatPatch {
                vendor_session_id: Some("thread".into()),
                ..patch
            };
            db.chats.update(&chat.id, &patch)?;
            Ok(chat.id)
        })
        .await
        .unwrap();
    Fixture {
        ctx,
        chat_id,
        db,
        data,
    }
}

async fn uncached_paged_chat() -> Fixture {
    chat_with(Arc::new(StubHistory::new(pages())), ChatPatch::default()).await
}

async fn warm_up(ctx: &Arc<AppCtx>, chat_id: &str, initial_window: bool) {
    let (status, _) = read_json(
        resume(
            State(ctx.clone()),
            Path(chat_id.to_owned()),
            Query(ResumeQuery {
                wait_for: Some(ResumeWaitFor::Transcript),
                initial_window,
            }),
        )
        .await,
    )
    .await
    .unwrap();
    assert_eq!(status, StatusCode::OK);
}

/// Whether the socket resume that follows can still answer its first
/// window from the adapter's pages.
async fn window_from_pages(ctx: &Arc<AppCtx>, chat_id: &str) -> bool {
    let request = JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: Some(RequestId::Number(1)),
        method: "session/resume".into(),
        params: Some(
            json!({"sessionId":chat_id, "cwd":"/tmp", "replayFrom":{"type":"start"},
            "_meta":{"_mainframe.dev":{"window":{"turns":10}}}}),
        ),
    };
    let options = ResumeOptions {
        windowed_history: true,
        ..Default::default()
    };
    ctx.chat
        .facade_hub
        .adapter_window_resume(&ctx.chat.chat_manager, &request, options, None)
        .await
        .is_some()
}

#[tokio::test]
async fn an_uncached_open_leaves_the_restore_to_the_paged_first_window() {
    let fixture = uncached_paged_chat().await;

    warm_up(&fixture.ctx, &fixture.chat_id, true).await;

    assert!(
        window_from_pages(&fixture.ctx, &fixture.chat_id).await,
        "the warm-up must not read the whole history ahead of the resume"
    );
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn without_a_first_window_the_warm_up_still_restores_the_history() {
    let fixture = uncached_paged_chat().await;

    warm_up(&fixture.ctx, &fixture.chat_id, false).await;

    assert!(!window_from_pages(&fixture.ctx, &fixture.chat_id).await);
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn a_chat_the_adapter_will_not_page_keeps_the_full_warm_up() {
    let history = Arc::new(StubHistory {
        declines: true,
        ..StubHistory::new(pages())
    });
    let fixture = chat_with(Arc::clone(&history), ChatPatch::default()).await;

    warm_up(&fixture.ctx, &fixture.chat_id, true).await;

    assert_eq!(history.loads(), 1, "the warm-up read the history");
    assert!(
        fixture
            .ctx
            .chat
            .chat_manager
            .is_chat_loaded(&fixture.chat_id)
    );
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn a_working_chat_keeps_the_full_warm_up() {
    let working = ChatPatch {
        process_state: Some(Some(ProcessState::Working)),
        ..Default::default()
    };
    let fixture = chat_with(Arc::new(StubHistory::new(pages())), working).await;

    warm_up(&fixture.ctx, &fixture.chat_id, true).await;

    assert!(
        fixture
            .ctx
            .chat
            .chat_manager
            .is_chat_loaded(&fixture.chat_id)
    );
    assert!(!window_from_pages(&fixture.ctx, &fixture.chat_id).await);
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn a_chat_with_a_current_snapshot_keeps_the_full_warm_up() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("thread.jsonl");
    tokio::fs::write(&source, "{}\n").await.unwrap();
    let history = || {
        Arc::new(StubHistory {
            source: Some(source.clone()),
            ..StubHistory::new(pages())
        })
    };
    let fixture = chat_with(history(), ChatPatch::default()).await;
    // A previous run's full load leaves the snapshot behind.
    warm_up(&fixture.ctx, &fixture.chat_id, false).await;
    let snapshot = fixture
        .data
        .join("cache/history")
        .join(format!("{}.json", fixture.chat_id));
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !snapshot.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the full load wrote its snapshot");
    fixture.ctx.chat.chat_manager.dispose();

    let restarted = context(fixture.db.clone(), fixture.data.clone(), history());
    warm_up(&restarted, &fixture.chat_id, true).await;

    assert!(restarted.chat.chat_manager.is_chat_loaded(&fixture.chat_id));
    assert!(!window_from_pages(&restarted, &fixture.chat_id).await);
    restarted.chat.chat_manager.dispose();
}
