use super::*;
use crate::test_support::read_json;

#[test]
fn viewing_query_opts_in_and_omitting_it_keeps_the_full_resume_contract() {
    let full =
        Query::<ResumeQuery>::try_from_uri(&"/api/chats/chat/resume".parse().unwrap()).unwrap();
    assert!(full.wait_for.is_none());
    assert!(!full.initial_window);
    let ready = Query::<ResumeQuery>::try_from_uri(
        &"/api/chats/chat/resume?waitFor=transcript".parse().unwrap(),
    )
    .unwrap();
    assert!(matches!(ready.wait_for, Some(ResumeWaitFor::Transcript)));
    assert!(!ready.initial_window);
    let tail = Query::<ResumeQuery>::try_from_uri(
        &"/api/chats/chat/resume?waitFor=transcript&initialWindow=true"
            .parse()
            .unwrap(),
    )
    .unwrap();
    assert!(tail.initial_window);
    assert!(
        Query::<ResumeQuery>::try_from_uri(
            &"/api/chats/chat/resume?waitFor=unknown".parse().unwrap()
        )
        .is_err()
    );
}

#[tokio::test]
async fn both_modes_reject_a_missing_chat_before_starting_background_work() {
    let ctx = AppCtx::test_ctx();
    for wait_for in [None, Some(ResumeWaitFor::Transcript)] {
        let (status, _) = read_json(
            resume(
                State(ctx.clone()),
                Path("missing-chat".into()),
                Query(ResumeQuery {
                    wait_for,
                    initial_window: false,
                }),
            )
            .await,
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}

mod viewing_warm_up {
    use super::*;
    use crate::Db;
    use crate::chat_test_support::StubAdapter;
    use mainframe_acp::ResumeOptions;
    use mainframe_types::acp::jsonrpc::{JsonRpcRequest, RequestId};
    use mainframe_types::chat::ChatMessage;
    use serde_json::json;

    fn message(n: usize) -> ChatMessage {
        serde_json::from_value(json!({"id":format!("m{n}"),"chatId":"c","type":"user",
            "timestamp":"2026-11-28T00:00:00Z","content":[{"type":"text","text":format!("message {n}")}]}))
        .unwrap()
    }

    /// An idle chat nothing has cached, on an adapter that pages its history:
    /// 60 messages in three pages, newest first.
    async fn uncached_paged_chat() -> (Arc<AppCtx>, String) {
        let directory = tempfile::tempdir().unwrap().keep();
        let db =
            Db::spawn(|| mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")))
                .unwrap();
        let ctx = Arc::new(
            AppCtx::test_builder(db, directory.join("data"))
                .build()
                .unwrap(),
        );
        let pages = (0..3)
            .map(|page| ((2 - page) * 20..(3 - page) * 20).map(message).collect())
            .collect();
        ctx.core
            .adapter_registry
            .register(StubAdapter::paged("codex", pages));
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
        let (ctx, chat_id) = uncached_paged_chat().await;

        warm_up(&ctx, &chat_id, true).await;

        assert!(
            window_from_pages(&ctx, &chat_id).await,
            "the warm-up must not read the whole history ahead of the resume"
        );
        ctx.chat.chat_manager.dispose();
    }

    #[tokio::test]
    async fn without_a_first_window_the_warm_up_still_restores_the_history() {
        let (ctx, chat_id) = uncached_paged_chat().await;

        warm_up(&ctx, &chat_id, false).await;

        assert!(!window_from_pages(&ctx, &chat_id).await);
        ctx.chat.chat_manager.dispose();
    }
}
