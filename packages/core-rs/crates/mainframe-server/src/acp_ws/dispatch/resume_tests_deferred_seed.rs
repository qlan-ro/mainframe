//! A windowed first resume replies before the chat's revision log is seeded, and
//! the log fills in behind it without breaking a cursor: a live revision that
//! lands first, a history page that seeds first, a reconnect.

use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};

use mainframe_chat::chat_surface::{ChatSurface as _, ChatSurfaceEvent};
use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayMessageType};

use super::*;

/// Answers the resume's one snapshot read with `first`; any later read gets
/// `later`, as when messages are cached after the reply was planned.
struct TwoStatePort {
    first: Vec<DisplayMessage>,
    later: Vec<DisplayMessage>,
    reads: AtomicUsize,
}

impl TwoStatePort {
    fn new(first: Vec<DisplayMessage>, later: Vec<DisplayMessage>) -> Arc<Self> {
        Arc::new(Self {
            first,
            later,
            reads: AtomicUsize::new(0),
        })
    }

    fn same(messages: Vec<DisplayMessage>) -> Arc<Self> {
        Self::new(messages.clone(), messages)
    }
}

impl ResumePort for TwoStatePort {
    fn resume_snapshot<'a>(&'a self, _session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
        Box::pin(async move {
            let read = self.reads.fetch_add(1, SeqCst);
            ResumeSnapshot {
                messages: if read == 0 {
                    self.first.clone()
                } else {
                    self.later.clone()
                },
                streaming: None,
                pending: None,
            }
        })
    }

    fn is_running(&self, _session_id: &str) -> bool {
        false
    }
}

fn message(id: &str, text: &str) -> DisplayMessage {
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

fn transcript(text: &str) -> Vec<DisplayMessage> {
    (0..120).map(|i| message(&format!("m{i}"), text)).collect()
}

fn revision_event(messages: Vec<DisplayMessage>) -> ChatSurfaceEvent {
    ChatSurfaceEvent::DisplayRevision {
        chat_id: "chat-1".to_string(),
        delta: mainframe_display::DisplayDelta {
            full: true,
            changes: Vec::new(),
            len: messages.len(),
            snapshot: mainframe_display::DisplaySnapshot::new(messages),
            stats: mainframe_display::ProjectionStats::default(),
        },
        streaming: None,
    }
}

fn windowed_request(id: i64, cursor: Value, floor: Option<&str>) -> JsonRpcRequest {
    let mut request = resume_request(id, "chat-1");
    let params = request.params.as_mut().unwrap();
    params["replayFrom"] = cursor;
    if let Some(floor) = floor {
        params["_meta"] = json!({ "_mainframe.dev": { "window": { "floorItemId": floor } } });
    }
    request
}

fn revision_of(ctx: &AppCtx) -> u64 {
    ctx.chat
        .facade_hub
        .revision_boundary("chat-1")
        .expect("the resume created the log")
        .revision
}

async fn windowed_connection(
    ctx: &Arc<AppCtx>,
) -> (Arc<FacadeConnection>, mpsc::UnboundedReceiver<String>) {
    let (_id, connection, rx) = ctx.chat.facade_hub.register("mock-cli".to_string());
    connection.mark_revision_cursors_opted_in();
    connection.mark_windowed_history_opted_in();
    (connection, rx)
}

async fn settle_seed(ctx: &AppCtx) {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while ctx.chat.facade_hub.history_seed_pending("chat-1") {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the log was seeded");
    // A seed that finds the log already filled leaves nothing to observe, so wait past it.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
}

#[tokio::test]
async fn the_reply_goes_out_before_the_log_is_seeded_and_the_seed_follows() {
    let ctx = AppCtx::test_ctx();
    let (connection, mut rx) = windowed_connection(&ctx).await;
    let port = TwoStatePort::same(transcript("hello"));

    start_resume(
        windowed_request(1, json!({"type":"start"}), None),
        &ctx,
        &connection,
        port.clone(),
    );

    let frames = drain(&mut rx).await;
    let reply = frames
        .iter()
        .find(|f| f["id"] == json!(1))
        .expect("the reply");
    assert_eq!(
        reply["result"]["_meta"]["_mainframe.dev"]["cursor"]["revision"],
        json!(0)
    );

    settle_seed(&ctx).await;
    assert!(!ctx.chat.facade_hub.history_seed_pending("chat-1"));
    assert_eq!(
        port.reads.load(SeqCst),
        1,
        "the seed reuses the reply's own snapshot, with no second read"
    );
}

#[tokio::test]
async fn the_seed_describes_what_the_reply_sent_not_a_later_transcript() {
    let ctx = AppCtx::test_ctx();
    let (connection, mut rx) = windowed_connection(&ctx).await;
    // A message cached after the reply's snapshot, not yet emitted.
    let mut later = transcript("hello");
    later[119] = message("m119", "appended after the reply was planned");
    let port = TwoStatePort::new(transcript("hello"), later.clone());
    start_resume(
        windowed_request(1, json!({"type":"start"}), None),
        &ctx,
        &connection,
        port.clone(),
    );
    drain(&mut rx).await;
    settle_seed(&ctx).await;

    // The emit that carries it must register as a change against the baseline the reply sent.
    ctx.chat
        .facade_hub
        .on_chat_surface_event(revision_event(later));
    drain(&mut rx).await;
    assert_eq!(
        revision_of(&ctx),
        1,
        "a baseline read after the reply would absorb the message at revision 0"
    );
}

#[tokio::test]
async fn a_live_revision_during_seeding_keeps_its_cursor_and_the_late_seed_changes_nothing() {
    let ctx = AppCtx::test_ctx();
    let (connection, mut rx) = windowed_connection(&ctx).await;
    let port = TwoStatePort::same(transcript("hello"));
    start_resume(
        windowed_request(1, json!({"type":"start"}), None),
        &ctx,
        &connection,
        port.clone(),
    );
    drain(&mut rx).await;

    ctx.chat
        .facade_hub
        .on_chat_surface_event(revision_event(transcript("edited")));
    drain(&mut rx).await;
    assert_eq!(revision_of(&ctx), 1);

    // The seed, working from the older transcript, must not touch a log a live revision already filled.
    settle_seed(&ctx).await;
    ctx.chat
        .facade_hub
        .on_chat_surface_event(revision_event(transcript("edited again")));
    drain(&mut rx).await;
    assert_eq!(revision_of(&ctx), 2);
}

#[tokio::test]
async fn a_history_page_seeding_first_leaves_the_late_seed_a_no_op() {
    let ctx = AppCtx::test_ctx();
    let (connection, mut rx) = windowed_connection(&ctx).await;
    let messages = transcript("hello");
    let port = TwoStatePort::same(messages.clone());
    start_resume(
        windowed_request(1, json!({"type":"start"}), None),
        &ctx,
        &connection,
        port.clone(),
    );
    drain(&mut rx).await;

    // What a page request does before serving: seed from its own copy (whichever
    // seeder reaches the log first, the other finds it filled).
    ctx.chat
        .facade_hub
        .seed_history_snapshot("chat-1", &messages);
    assert!(!ctx.chat.facade_hub.history_seed_pending("chat-1"));

    settle_seed(&ctx).await;
    ctx.chat
        .facade_hub
        .on_chat_surface_event(revision_event(transcript("edited")));
    drain(&mut rx).await;
    assert_eq!(
        revision_of(&ctx),
        1,
        "one revision recorded once, incrementally, against the page's seed"
    );
}

#[tokio::test]
async fn a_reconnect_after_the_reply_carries_a_change_made_while_seeding() {
    let ctx = AppCtx::test_ctx();
    let (connection, mut rx) = windowed_connection(&ctx).await;
    let port = TwoStatePort::same(transcript("hello"));
    start_resume(
        windowed_request(1, json!({"type":"start"}), None),
        &ctx,
        &connection,
        port.clone(),
    );
    let frames = drain(&mut rx).await;
    let reply = frames.iter().find(|f| f["id"] == json!(1)).unwrap();
    let meta = &reply["result"]["_meta"]["_mainframe.dev"];
    let (epoch, revision) = (
        meta["cursor"]["epoch"].clone(),
        meta["cursor"]["revision"].clone(),
    );
    let floor = meta["history"]["floorItemId"].as_str().unwrap().to_string();

    let mut edited = transcript("hello");
    edited[110] = message("m110", "edited while seeding");
    ctx.chat
        .facade_hub
        .on_chat_surface_event(revision_event(edited.clone()));
    drain(&mut rx).await;
    settle_seed(&ctx).await;

    let reconnect = windowed_request(
        2,
        json!({"type":"revision","epoch":epoch,"revision":revision}),
        Some(&floor),
    );
    start_resume(reconnect, &ctx, &connection, TwoStatePort::same(edited));
    let frames = drain(&mut rx).await;
    assert!(
        frames
            .iter()
            .any(|f| f.to_string().contains("edited while seeding")),
        "the reconnect carries the edit: {frames:?}"
    );
}
