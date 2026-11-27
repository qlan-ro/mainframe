//! A windowed first resume replies before the chat's revision log is seeded, and
//! the log fills in behind it without breaking a cursor: a live revision that
//! lands first, a history page that seeds first, a reconnect.

use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};

use mainframe_chat::chat_surface::{ChatSurface as _, ChatSurfaceEvent};
use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayMessageType};
use tokio::sync::Notify;

use super::*;

/// The first snapshot read (the resume itself) answers at once; every later one
/// (the seed behind the reply) waits until the test lets it through.
struct HeldSeedPort {
    messages: Vec<DisplayMessage>,
    reads: AtomicUsize,
    seed_reads_done: AtomicUsize,
    release: Notify,
}

impl HeldSeedPort {
    fn new(messages: Vec<DisplayMessage>) -> Arc<Self> {
        Arc::new(Self {
            messages,
            reads: AtomicUsize::new(0),
            seed_reads_done: AtomicUsize::new(0),
            release: Notify::new(),
        })
    }
}

impl ResumePort for HeldSeedPort {
    fn resume_snapshot<'a>(&'a self, _session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
        Box::pin(async move {
            let read = self.reads.fetch_add(1, SeqCst);
            if read > 0 {
                self.release.notified().await;
                self.seed_reads_done.fetch_add(1, SeqCst);
            }
            ResumeSnapshot {
                messages: self.messages.clone(),
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

async fn settle_seed(port: &HeldSeedPort) {
    port.release.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while port.seed_reads_done.load(SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the seed read the transcript");
    // The encode and install run on a blocking thread after the read, and a seed that finds the
    // log already filled leaves nothing to observe, so wait past it: a late write would show.
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
}

#[tokio::test]
async fn the_reply_goes_out_before_the_log_is_seeded_and_the_seed_follows() {
    let ctx = AppCtx::test_ctx();
    let (connection, mut rx) = windowed_connection(&ctx).await;
    let port = HeldSeedPort::new(transcript("hello"));

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
    assert!(
        ctx.chat.facade_hub.history_seed_pending("chat-1"),
        "the seed is still waiting on its snapshot, and the reply is already out"
    );

    settle_seed(&port).await;
    assert!(!ctx.chat.facade_hub.history_seed_pending("chat-1"));
}

#[tokio::test]
async fn a_live_revision_during_seeding_keeps_its_cursor_and_the_late_seed_changes_nothing() {
    let ctx = AppCtx::test_ctx();
    let (connection, mut rx) = windowed_connection(&ctx).await;
    let port = HeldSeedPort::new(transcript("hello"));
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
    settle_seed(&port).await;
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
    let port = HeldSeedPort::new(messages.clone());
    start_resume(
        windowed_request(1, json!({"type":"start"}), None),
        &ctx,
        &connection,
        port.clone(),
    );
    drain(&mut rx).await;
    assert!(ctx.chat.facade_hub.history_seed_pending("chat-1"));

    // What a page request does before serving: seed from its own copy.
    ctx.chat
        .facade_hub
        .seed_history_snapshot("chat-1", &messages);
    assert!(!ctx.chat.facade_hub.history_seed_pending("chat-1"));

    settle_seed(&port).await;
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
    let port = HeldSeedPort::new(transcript("hello"));
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
    settle_seed(&port).await;

    let reconnect = windowed_request(
        2,
        json!({"type":"revision","epoch":epoch,"revision":revision}),
        Some(&floor),
    );
    start_resume(
        reconnect,
        &ctx,
        &connection,
        Arc::new(FixedSnapshot(edited)),
    );
    let frames = drain(&mut rx).await;
    assert!(
        frames
            .iter()
            .any(|f| f.to_string().contains("edited while seeding")),
        "the reconnect carries the edit: {frames:?}"
    );
}

struct FixedSnapshot(Vec<DisplayMessage>);

impl ResumePort for FixedSnapshot {
    fn resume_snapshot<'a>(&'a self, _session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
        let messages = self.0.clone();
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
