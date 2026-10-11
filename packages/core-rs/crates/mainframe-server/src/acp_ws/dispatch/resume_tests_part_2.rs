#[tokio::test]
async fn a_resume_that_succeeds_clears_the_failure_count() {
    let ctx = AppCtx::test_ctx();
    let (_client_id, connection, mut rx) = ctx.chat.facade_hub.register("mock-cli".to_string());

    start_resume(
        resume_request(1, "chat-1"),
        &ctx,
        &connection,
        Arc::new(PanickingPort),
    );
    assert_eq!(resyncs(&drain(&mut rx).await), 1);

    start_resume(
        resume_request(2, "chat-1"),
        &ctx,
        &connection,
        Arc::new(EmptyPort),
    );
    drain(&mut rx).await;

    start_resume(
        resume_request(3, "chat-1"),
        &ctx,
        &connection,
        Arc::new(PanickingPort),
    );

    assert_eq!(
        resyncs(&drain(&mut rx).await),
        1,
        "a resume that worked since means this failure is not the loop"
    );
}

// End-to-end revision-cursor cases through `start_resume` live
// in `revision_cursor_tests.rs`, split out to keep this file under 300
// lines — it shares this file's fixtures via `use super::*`.
#[path = "resume_tests_revision_cursor_tests.rs"]
mod revision_cursor_tests;

// ── Compressed replay batches ────────────────────────────────────────────────

/// A chat with one settled assistant message, so a resume has something to replay.
struct OneMessagePort;

impl ResumePort for OneMessagePort {
    fn resume_snapshot<'a>(&'a self, _session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
        Box::pin(async {
            ResumeSnapshot {
                messages: vec![mainframe_types::display::DisplayMessage {
                    id: "m1".to_string(),
                    chat_id: "chat-1".to_string(),
                    r#type: mainframe_types::display::DisplayMessageType::Assistant,
                    content: vec![mainframe_types::display::DisplayContent::Leaf(
                        mainframe_types::content::LeafContent::Text {
                            text: "hello".to_string(),
                            parent_tool_use_id: None,
                        },
                    )],
                    timestamp: "2026-08-28T00:00:00.000Z".to_string(),
                    metadata: None,
                }],
                streaming: None,
                pending: None,
            }
        })
    }

    fn is_running(&self, _session_id: &str) -> bool {
        false
    }
}

fn methods(frames: &[Value]) -> Vec<String> {
    frames
        .iter()
        .map(|frame| {
            frame["method"]
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| format!("reply:{}", frame["id"]))
        })
        .collect()
}

#[tokio::test]
async fn an_opted_in_connection_takes_its_replay_as_one_compressed_batch() {
    let ctx = AppCtx::test_ctx();
    let (_client_id, connection, mut rx) = ctx.chat.facade_hub.register("mock-cli".to_string());
    connection.mark_compressed_replay_opted_in();

    start_resume(
        resume_request(7, "chat-1"),
        &ctx,
        &connection,
        Arc::new(OneMessagePort),
    );

    let frames = drain(&mut rx).await;
    assert_eq!(
        methods(&frames),
        vec![
            "reply:7",
            "_mainframe.dev/replay_batch",
            "_mainframe.dev/queue_state",
            "_mainframe.dev/replay_complete",
        ]
    );
    // The message create plus the trailing state_update, in one batch.
    assert_eq!(frames[1]["params"]["count"], json!(2));
    assert_eq!(frames[1]["params"]["encoding"], json!("deflate+base64"));
    assert_eq!(frames[1]["params"]["sessionId"], json!("chat-1"));
}

#[tokio::test]
async fn a_connection_that_did_not_opt_in_keeps_the_per_update_replay() {
    let ctx = AppCtx::test_ctx();
    let (_client_id, connection, mut rx) = ctx.chat.facade_hub.register("mock-cli".to_string());

    start_resume(
        resume_request(7, "chat-1"),
        &ctx,
        &connection,
        Arc::new(OneMessagePort),
    );

    let frames = drain(&mut rx).await;
    assert_eq!(
        methods(&frames),
        vec![
            "reply:7",
            "session/update",
            "session/update",
            "_mainframe.dev/queue_state",
            "_mainframe.dev/replay_complete",
        ]
    );
}
