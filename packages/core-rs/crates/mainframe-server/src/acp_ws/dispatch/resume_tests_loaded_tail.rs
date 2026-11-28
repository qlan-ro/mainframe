//! What a windowed first resume leaves for the next start: a reply from
//! adapter pages, or one that read the history before any validation existed,
//! stores no tail itself, so `complete_history` stores one once the history
//! is complete (`deliver_resume` → `persist_loaded_tail`).
use std::path::PathBuf;

use super::*;
use crate::Db;
use crate::acp_ws::hub::FacadeHub;
use crate::acp_ws::ports::ManagerPorts;
use crate::chat_test_support::{StubAdapter, StubHistory};
use mainframe_types::chat::ChatMessage;

fn message(n: usize) -> ChatMessage {
    serde_json::from_value(json!({"id":format!("m{n}"),"chatId":"c","type":"user",
        "timestamp":"2026-11-28T00:00:00Z","content":[{"type":"text","text":format!("message {n}")}]}))
    .unwrap()
}

struct Fixture {
    ctx: Arc<AppCtx>,
    chat_id: String,
    history: Arc<StubHistory>,
    data: PathBuf,
    _directory: tempfile::TempDir,
}

/// An idle, uncached chat of 60 messages in three pages, pinned to a file so
/// its history validates, on a hub that stores tails. `declines`: the
/// adapter will not page it.
async fn fixture(declines: bool) -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("thread.jsonl");
    tokio::fs::write(&source, "{}\n").await.unwrap();
    let data = directory.path().join("data");
    let db = Db::spawn(|| mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")))
        .unwrap();
    let hub = Arc::new(FacadeHub::default().with_history_tails(data.join("tails")));
    let ctx = Arc::new(
        AppCtx::test_builder(db, data.clone())
            .facade_hub(hub)
            .build()
            .unwrap(),
    );
    let pages = (0..3)
        .map(|page| ((2 - page) * 20..(3 - page) * 20).map(message).collect())
        .collect();
    let history = Arc::new(StubHistory {
        declines,
        source: Some(source),
        ..StubHistory::new(pages)
    });
    ctx.core
        .adapter_registry
        .register(StubAdapter::with_history("codex", Arc::clone(&history)));
    let path = directory.path().to_string_lossy().into_owned();
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
    Fixture {
        ctx,
        chat_id,
        history,
        data,
        _directory: directory,
    }
}

/// Opens the chat as the desktop does: a windowed first resume of 10 turns.
async fn open(fixture: &Fixture) -> Vec<Value> {
    let (_id, connection, mut rx) = fixture.ctx.chat.facade_hub.register("codex".into());
    connection.mark_windowed_history_opted_in();
    let mut request = resume_request(1, &fixture.chat_id);
    request.params.as_mut().unwrap()["_meta"] =
        json!({ "_mainframe.dev": { "window": { "turns": 10 } } });
    let ports = Arc::new(ManagerPorts::new(Some(Arc::clone(
        &fixture.ctx.chat.chat_manager,
    ))));
    start_resume(request, &fixture.ctx, &connection, ports);
    drain(&mut rx).await
}

async fn tail_stored(fixture: &Fixture) -> bool {
    let manifest = fixture
        .data
        .join("tails")
        .join(format!("{}.meta.json", fixture.chat_id));
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !manifest.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .is_ok()
}

fn replied(frames: &[Value]) -> bool {
    frames
        .iter()
        .any(|f| f["id"] == json!(1) && f.get("result").is_some())
}

#[tokio::test]
async fn a_first_window_from_pages_leaves_a_tail_and_reads_the_history_once() {
    let fixture = fixture(false).await;

    let frames = open(&fixture).await;

    assert!(replied(&frames));
    assert!(tail_stored(&fixture).await, "the next start finds a tail");
    assert_eq!(
        fixture.history.loads(),
        1,
        "one full load, behind the reply"
    );
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn a_resume_that_read_the_history_itself_still_leaves_a_tail() {
    // Declined and opened with no warm-up first: the resume reads the whole
    // history before any validation exists, so it cannot store the tail itself.
    let fixture = fixture(true).await;

    let frames = open(&fixture).await;

    assert!(replied(&frames));
    assert!(tail_stored(&fixture).await);
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn a_declined_chat_after_the_full_warm_up_reads_its_history_once() {
    let fixture = fixture(true).await;
    let manager = &fixture.ctx.chat.chat_manager;
    assert!(!manager.adapter_window_candidate(&fixture.chat_id).await);
    manager.resume_transcript(&fixture.chat_id).await;

    let frames = open(&fixture).await;

    assert!(replied(&frames));
    assert!(tail_stored(&fixture).await);
    assert_eq!(
        fixture.history.loads(),
        1,
        "the resume and the load behind it reuse the warm-up's read"
    );
    manager.dispose();
}
