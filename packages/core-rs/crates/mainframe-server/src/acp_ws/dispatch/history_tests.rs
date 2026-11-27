use std::sync::Arc;

use serde_json::{Value, json};

use crate::acp_ws::dispatch::handle_inbound;
use crate::{AppCtx, Db};

pub(super) async fn chat_with_history() -> (tempfile::TempDir, Arc<AppCtx>, String) {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("session.jsonl");
    let contents: String = (0..100)
        .map(|i| {
            format!(
                "{}\n",
                json!({"type":"user","uuid":format!("m{i}"),
                "sessionId":"session","timestamp":"2026-10-01T00:00:00Z",
                "message":{"role":"user","content":format!("message {i}")}})
            )
        })
        .collect();
    tokio::fs::write(&source, contents).await.unwrap();
    let db = Db::spawn(|| mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")))
        .unwrap();
    let ctx = Arc::new(
        AppCtx::test_builder(db, directory.path().join("data"))
            .build()
            .unwrap(),
    );
    ctx.core.adapter_registry.register(Arc::new(
        mainframe_adapter_claude::adapter::ClaudeAdapter::new(
            ctx.core.background_tasks.clone(),
            ctx.core.claude_workflows.clone(),
            ctx.core.resolved_path.clone(),
        ),
    ));
    let path = directory.path().to_string_lossy().into_owned();
    let file = source.to_string_lossy().into_owned();
    let chat_id = ctx
        .core
        .db
        .call(move |db| {
            let project = db.projects.create(&path, None)?;
            let chat = db.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id,
                adapter_id: "claude".into(),
                ..Default::default()
            })?;
            db.chats.update(
                &chat.id,
                &mainframe_types::chat_patch::ChatPatch {
                    vendor_session_id: Some("session".into()),
                    session_file_path: Some(file),
                    ..Default::default()
                },
            )?;
            Ok(chat.id)
        })
        .await
        .unwrap();
    (directory, ctx, chat_id)
}

async fn call(ctx: &Arc<AppCtx>, method: &str, params: Value) -> Value {
    call_with(ctx, method, params, |_| {}).await.0
}

/// The reply plus every binary frame the call produced, for a connection
/// `setup` has configured.
pub(super) async fn call_with(
    ctx: &Arc<AppCtx>,
    method: &str,
    params: Value,
    setup: impl FnOnce(&crate::acp_ws::facade_conn::FacadeConnection),
) -> (Value, Vec<Vec<u8>>) {
    let (_, conn, mut rx) = ctx.chat.facade_hub.register("claude".into());
    conn.mark_negotiated();
    setup(&conn);
    let mut binary = conn.take_binary_frames().unwrap();
    let daemon = mainframe_acp::DaemonInfo {
        version: "test".into(),
        heartbeat_interval_ms: 15000,
    };
    let text = json!({"jsonrpc":"2.0","id":7,"method":method,"params":params}).to_string();
    assert!(handle_inbound(&text, &daemon, ctx, &conn).await.is_none());
    let reply = tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv())
        .await
        .unwrap()
        .unwrap();
    let frames = std::iter::from_fn(|| binary.try_recv().ok()).collect();
    (serde_json::from_str(&reply).unwrap(), frames)
}

#[tokio::test]
async fn history_around_and_search_are_routed_and_answered() {
    let (_keep, ctx, chat) = chat_with_history().await;
    let found = call(
        &ctx,
        "_mainframe.dev/history_search",
        json!({"sessionId":chat,"query":"message 7"}),
    )
    .await;
    assert_eq!(found["id"], 7);
    assert_eq!(found["result"]["total"], 11);

    let around = call(
        &ctx,
        "_mainframe.dev/history_around",
        json!({"sessionId":chat,"itemId":"m50","before":3,"after":2}),
    )
    .await;
    let result = &around["result"];
    assert_eq!(result["hasBefore"], true);
    assert_eq!(result["hasAfter"], true);
    assert!(result.get("stale").is_none());
    let first = result["firstItemId"].as_str().unwrap();
    let last = result["lastItemId"].as_str().unwrap();
    assert!(
        first.ends_with(":m47") && last.ends_with(":m52"),
        "{result}"
    );
    assert!(result["targetItemId"].as_str().unwrap().ends_with(":m50"));

    let missing = call(
        &ctx,
        "_mainframe.dev/history_around",
        json!({"sessionId":chat,"itemId":"nope"}),
    )
    .await;
    assert_eq!(missing["result"]["stale"], true);

    let bad = call(
        &ctx,
        "_mainframe.dev/history_around",
        json!({"sessionId":chat}),
    )
    .await;
    assert!(bad["error"].is_object());
}

mod routing {
    use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};

    use mainframe_acp::resume::{BoxFuture, MessageReader, ResumeSnapshot};
    use mainframe_acp::{ResumePort, history_page::PageOptions};
    use mainframe_types::acp::extensions::HistoryPageParams;
    use mainframe_types::display::DisplayMessage;

    use super::super::compute_page;
    use crate::acp_ws::hub::FacadeHub;
    use std::sync::Arc;

    /// Records which read path a page took: `read_messages` borrows the list,
    /// `resume_snapshot` copies it.
    #[derive(Default)]
    struct Spy {
        messages: Vec<DisplayMessage>,
        borrowed: AtomicUsize,
        copied: AtomicUsize,
    }

    impl ResumePort for Spy {
        fn resume_snapshot<'a>(&'a self, _: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
            self.copied.fetch_add(1, SeqCst);
            Box::pin(async move {
                ResumeSnapshot {
                    messages: self.messages.clone(),
                    streaming: None,
                    pending: None,
                }
            })
        }
        fn is_running(&self, _: &str) -> bool {
            false
        }
        fn read_messages<'a>(&'a self, _: &'a str, read: MessageReader<'a>) -> BoxFuture<'a, ()> {
            self.borrowed.fetch_add(1, SeqCst);
            Box::pin(async move { read(&self.messages) })
        }
    }

    fn spy() -> Arc<Spy> {
        let messages = (0..60)
            .map(|i| {
                serde_json::from_value(serde_json::json!({"id":format!("m{i}"),"chatId":"c",
                    "type":"user","timestamp":"now","content":[{"type":"text","text":"x"}]}))
                .unwrap()
            })
            .collect();
        Arc::new(Spy {
            messages,
            ..Spy::default()
        })
    }

    fn params(until: Option<&str>) -> HistoryPageParams {
        HistoryPageParams {
            session_id: "c".into(),
            before: "message:0:top:m50".into(),
            containers: Some(10),
            items: None,
            turns: None,
            until_item_id: until.map(str::to_owned),
        }
    }

    /// A hub whose chat `c` has a seeded revision log.
    fn seeded_hub(spy: &Spy) -> Arc<FacadeHub> {
        let hub = Arc::new(FacadeHub::default());
        hub.open_revision_log_for_test("c");
        hub.seed_history_snapshot("c", &spy.messages);
        assert!(!hub.history_seed_pending("c"));
        hub
    }

    async fn run(spy: &Arc<Spy>, hub: &Arc<FacadeHub>, params: HistoryPageParams) {
        let page = compute_page(spy.clone(), hub.clone(), params, PageOptions::default()).await;
        assert!(page.is_some());
    }

    #[tokio::test]
    async fn a_bounded_page_on_a_seeded_chat_borrows_the_list() {
        let spy = spy();
        let hub = seeded_hub(&spy);
        run(&spy, &hub, params(None)).await;
        assert_eq!((spy.borrowed.load(SeqCst), spy.copied.load(SeqCst)), (1, 0));
    }

    #[tokio::test]
    async fn a_load_through_page_copies_the_list_off_the_lock() {
        let spy = spy();
        let hub = seeded_hub(&spy);
        run(&spy, &hub, params(Some("m10"))).await;
        assert_eq!((spy.borrowed.load(SeqCst), spy.copied.load(SeqCst)), (0, 1));
    }

    #[tokio::test]
    async fn a_page_after_an_epoch_reset_copies_and_reseeds() {
        let spy = spy();
        let hub = seeded_hub(&spy);
        hub.reset_revision_epoch_for_test("c");
        assert!(hub.history_seed_pending("c"));
        run(&spy, &hub, params(None)).await;
        assert_eq!((spy.borrowed.load(SeqCst), spy.copied.load(SeqCst)), (0, 1));
        assert!(!hub.history_seed_pending("c"));
    }

    #[tokio::test]
    async fn a_load_through_page_seeds_an_unseeded_log() {
        let spy = spy();
        let hub = Arc::new(FacadeHub::default());
        hub.open_revision_log_for_test("c");
        run(&spy, &hub, params(Some("m10"))).await;
        assert_eq!(spy.copied.load(SeqCst), 1);
        assert!(!hub.history_seed_pending("c"));
    }

    #[test]
    fn seed_pending_follows_the_revision_log() {
        let spy = spy();
        let hub = FacadeHub::default();
        assert!(!hub.history_seed_pending("c"), "no log, nothing to seed");
        hub.open_revision_log_for_test("c");
        assert!(hub.history_seed_pending("c"));
        hub.seed_history_snapshot("c", &spy.messages);
        assert!(!hub.history_seed_pending("c"));
        hub.reset_revision_epoch_for_test("c");
        assert!(hub.history_seed_pending("c"));
    }
}
