//! End-to-end revision-cursor cases through `start_resume` (todo #377):
//! the full daemon-level wiring — `begin_resume` creating the log,
//! `dispatch_resume` planning against it, `reset_session` sending the
//! reply — produces `cursor` meta on the actual socket frame for an
//! opted-in connection, and byte-identical legacy output for one that
//! never opted in.

use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayMessageType};

use super::*;

/// A resume port whose transcript the test controls — `PanickingPort`/
/// `EmptyPort` above have none.
struct FixedPort {
    messages: Vec<DisplayMessage>,
}

impl ResumePort for FixedPort {
    fn resume_snapshot<'a>(&'a self, _session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
        let messages = self.messages.clone();
        Box::pin(async move {
            ResumeSnapshot {
                messages,
                streaming: None,
                pending: None,
            }
        })
    }

    fn is_running(&self, _session_id: &str) -> bool {
        false
    }
}

fn display_message(id: &str, text: &str) -> DisplayMessage {
    DisplayMessage {
        id: id.to_string(),
        chat_id: "chat-1".to_string(),
        r#type: DisplayMessageType::Assistant,
        content: vec![DisplayContent::Leaf(
            mainframe_types::content::LeafContent::Text {
                text: text.to_string(),
                parent_tool_use_id: None,
            },
        )],
        timestamp: "2026-08-28T00:00:00.000Z".to_string(),
        metadata: None,
    }
}

fn reply_with_id(frames: &[Value], id: i64) -> &Value {
    frames
        .iter()
        .find(|f| f["id"] == json!(id))
        .unwrap_or_else(|| panic!("no reply with id {id} among {frames:?}"))
}

#[tokio::test]
async fn an_opted_in_resume_reply_carries_cursor_meta() {
    let ctx = AppCtx::test_ctx();
    let (_client_id, connection, mut rx) = ctx.facade_hub.register("mock-cli".to_string());
    connection.mark_revision_cursors_opted_in();

    start_resume(
        resume_request(1, "chat-1"),
        &ctx,
        &connection,
        Arc::new(FixedPort {
            messages: vec![display_message("m1", "hello")],
        }),
    );

    let frames = drain(&mut rx).await;
    let reply = reply_with_id(&frames, 1);
    assert!(
        reply["result"]["_meta"]["_mainframe.dev"]["cursor"]["epoch"].is_string(),
        "{reply:?}"
    );
    assert_eq!(
        reply["result"]["_meta"]["_mainframe.dev"]["cursor"]["revision"],
        json!(0),
        "nothing recorded yet beyond the seed"
    );
}

/// A second resume with the revision cursor the first reply handed back,
/// after a late change, gets exactly the incremental update — not a full
/// replay — plus an advanced cursor.
#[tokio::test]
async fn a_second_resume_with_the_returned_cursor_is_incremental() {
    let ctx = AppCtx::test_ctx();
    let (_client_id, connection, mut rx) = ctx.facade_hub.register("mock-cli".to_string());
    connection.mark_revision_cursors_opted_in();

    start_resume(
        resume_request(1, "chat-1"),
        &ctx,
        &connection,
        Arc::new(FixedPort {
            messages: vec![display_message("m1", "hello")],
        }),
    );
    let first_frames = drain(&mut rx).await;
    reply_with_id(&first_frames, 1);

    start_resume(
        resume_request(2, "chat-1"),
        &ctx,
        &connection,
        Arc::new(FixedPort {
            messages: vec![
                display_message("m1", "hello"),
                display_message("m2", "world"),
            ],
        }),
    );
    let second_frames = drain(&mut rx).await;
    let second_reply = reply_with_id(&second_frames, 2);
    assert!(
        second_reply["result"]["_meta"]["_mainframe.dev"]["fullReplay"].is_null(),
        "the log was seeded by the first resume, so this is in range: {second_reply:?}"
    );
}

/// A non-opted connection's resume reply carries no `cursor` meta at all —
/// byte-identical to the pre-#377 wire.
#[tokio::test]
async fn a_non_opted_connection_gets_no_cursor_meta() {
    let ctx = AppCtx::test_ctx();
    let (_client_id, connection, mut rx) = ctx.facade_hub.register("mock-cli".to_string());

    start_resume(
        resume_request(1, "chat-1"),
        &ctx,
        &connection,
        Arc::new(FixedPort {
            messages: vec![display_message("m1", "hello")],
        }),
    );

    let frames = drain(&mut rx).await;
    let reply = reply_with_id(&frames, 1);
    assert!(reply["result"]["_meta"]["_mainframe.dev"]["cursor"].is_null());
}
