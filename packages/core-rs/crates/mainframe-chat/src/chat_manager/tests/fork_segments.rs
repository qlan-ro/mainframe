//! Forks of multi-segment chats: a from-message fork must cut inside the
//! latest provider segment, a fork copies the parent's segments (pinned or
//! borrowed), and an unsent fork that switches provider borrows its pin.

use mainframe_types::segment::{
    ForkSegmentRole, HandoffStatus, SegmentKind, SegmentLayout, SwitchProviderRequest,
};

use super::provider_switch::{codex_info, text_message};
use super::segment_fake::{FakeStore, native, segment};
use super::*;
use crate::fork::{ForkPoint, PendingForkState};

/// Claude (s0 on ns_c), then Codex (s1 on ns_x, handoff delivered); Codex active.
fn claude_then_codex() -> SegmentLayout {
    let mut layout = SegmentLayout {
        segments: vec![
            segment("s0", 0, "ns_c", SegmentKind::Initial),
            segment("s1", 1, "ns_x", SegmentKind::ProviderSwitch),
        ],
        natives: vec![
            native("ns_c", "claude", Some("c-1")),
            native("ns_x", "codex", Some("x-1")),
        ],
        handoffs: vec![],
    };
    layout.segments[0].last_message_id = Some("a1".into());
    layout.segments[1].closed_at = None;
    layout
}

fn user(id: &str) -> ChatMessage {
    text_message(id, ChatMessageType::User, id)
}

fn reply(id: &str) -> ChatMessage {
    text_message(&format!("{id}-reply"), ChatMessageType::Assistant, "ok")
}

/// A Codex parent whose Claude turn (u1) came before the switch, then x1, x2.
fn setup_parent() -> (Arc<StoreDeps>, Arc<FakeStore>, ChatManager) {
    std::fs::create_dir_all("/tmp/test").expect("create the fake project dir");
    let mut chat = test_chat("c1");
    chat.adapter_id = "codex".into();
    chat.claude_session_id = Some("x-1".into());
    chat.status = ChatStatus::Active;
    let deps = StoreDeps::with_chats(vec![chat]);
    deps.set_fork_capable(true);
    let layout = claude_then_codex();
    let store = FakeStore::with_layout(layout.clone());
    deps.set_segment_store(store.clone());
    // Every native session reloads this; the Codex segment's slice holds x2.
    deps.set_history(vec![user("x1"), reply("x1"), user("x2"), reply("x2")]);
    let mgr = ChatManager::new(deps.clone());
    let divider = crate::segments::divider::divider_for("c1", &layout, "s1", &|id| match id {
        "codex" => "Codex".into(),
        other => other.into(),
    })
    .expect("divider");
    let live = [
        user("u1"),
        reply("u1"),
        divider,
        user("x1"),
        reply("x1"),
        user("x2"),
        reply("x2"),
    ];
    let mut cache = mgr.messages.lock().unwrap();
    for message in live {
        cache.append("c1", message);
    }
    drop(cache);
    (deps, store, mgr)
}

#[tokio::test]
async fn a_message_before_the_switch_is_refused_with_no_pin() {
    let (deps, _store, mgr) = setup_parent();
    let err = mgr
        .fork_chat("c1", ForkPoint::BeforeMessage("x1".into()))
        .await
        .unwrap_err();
    assert_eq!(err, ForkChatError::BeforeProviderSwitch("Codex".into()));
    assert_eq!(err.status_code(), 409);
    let err = mgr
        .fork_chat("c1", ForkPoint::BeforeMessage("u1".into()))
        .await
        .unwrap_err();
    assert_eq!(err, ForkChatError::NothingBeforeMessage);
    assert!(deps.pin_requests().is_empty());
    assert!(deps.fork_inserts().is_empty());
}

#[tokio::test]
async fn a_cut_in_the_latest_segment_pins_it_and_borrows_the_rest() {
    let (deps, _store, mgr) = setup_parent();
    mgr.fork_chat("c1", ForkPoint::BeforeMessage("x2".into()))
        .await
        .expect("fork");
    let cut = deps.pin_requests()[0].cut.clone().unwrap();
    assert_eq!(cut.vendor_message_id, "x2");
    let plan = deps.fork_inserts()[0]
        .segments
        .clone()
        .expect("a segment plan");
    assert_eq!(plan.segments.len(), 2);
    assert_eq!(
        plan.segments[0].role,
        ForkSegmentRole::Borrowed {
            end_message_id: Some("a1".into()),
            end_at: Some("t".into()),
        }
    );
    assert_eq!(plan.segments[1].role, ForkSegmentRole::Pinned);
    assert!(!plan.pending_active);
}

#[tokio::test]
async fn a_whole_chat_fork_copies_every_segment() {
    let (deps, _store, mgr) = setup_parent();
    mgr.fork_chat("c1", ForkPoint::Current).await.expect("fork");
    let plan = deps.fork_inserts()[0]
        .segments
        .clone()
        .expect("a segment plan");
    let ids: Vec<&str> = plan
        .segments
        .iter()
        .map(|s| s.source_segment_id.as_str())
        .collect();
    assert_eq!(ids, ["s0", "s1"]);
    assert_eq!(plan.segments[1].role, ForkSegmentRole::Pinned);
}

#[tokio::test]
async fn a_single_segment_parent_sends_no_plan() {
    let (deps, store, mgr) = setup_parent();
    let mut single = claude_then_codex();
    single.segments.truncate(1);
    single.segments[0].closed_at = None;
    *store.layout.lock().unwrap() = single;
    mgr.fork_chat("c1", ForkPoint::Current).await.expect("fork");
    assert!(deps.fork_inserts()[0].segments.is_none());
}

/// An unsent Claude fork of c1: one segment on an id-less pinned row.
fn setup_unsent_fork() -> (Arc<StoreDeps>, Arc<FakeStore>, ChatManager) {
    std::fs::create_dir_all("/tmp/test").expect("create the fake project dir");
    let mut fork = test_chat("fork-1");
    fork.adapter_id = "claude".into();
    fork.parent_chat_id = Some(Some("c1".into()));
    fork.created_at = "2026-10-06T12:00:00Z".into();
    let deps = StoreDeps::with_chats(vec![fork]);
    let mut layout = SegmentLayout {
        segments: vec![segment("s0", 0, "ns_f", SegmentKind::Initial)],
        natives: vec![native("ns_f", "claude", None)],
        handoffs: vec![],
    };
    layout.segments[0].closed_at = None;
    let store = FakeStore::with_layout(layout);
    deps.set_segment_store(store.clone());
    deps.set_adapter_info(codex_info());
    deps.set_pending_fork(
        "fork-1",
        PendingForkState {
            fork_source: mainframe_types::adapter::ForkSource {
                source_session_id: "parent-sess".into(),
                resume_path: Some("/tmp/fork-snapshots/n1/parent-sess.jsonl".into()),
                last_turn_id: None,
            },
            snapshot_dir: "/tmp/fork-snapshots/n1".into(),
            provisional_title: "Untitled (fork)".into(),
        },
    );
    deps.set_history(vec![user("p1"), reply("p1")]);
    let mgr = ChatManager::new(deps.clone());
    (deps, store, mgr)
}

#[tokio::test]
async fn an_unsent_fork_that_switches_borrows_its_pin() {
    let (_deps, store, mgr) = setup_unsent_fork();
    let req = SwitchProviderRequest {
        adapter_id: "codex".into(),
        model: Some("codex-pro".into()),
        tuning: None,
    };
    mgr.switch_provider("fork-1", &req).await.expect("switch");

    let commit = store.commits.lock().unwrap()[0].clone();
    let conversion = commit.borrow_pinned.expect("the pin is borrowed");
    assert_eq!(conversion.native_ref, "ns_f");
    assert_eq!(conversion.owner_chat_id, "c1");
    assert_eq!(conversion.native_session_id, "parent-sess");
    assert_eq!(conversion.bounds.len(), 1);
    assert_eq!(
        conversion.bounds[0].end_message_id.as_deref(),
        Some("p1-reply")
    );
    // The borrowed row is never resumed: the target starts fresh.
    let open = commit.open_segment.expect("a new segment");
    assert!(matches!(
        open.native,
        mainframe_types::segment::OpenNative::Fresh { ref adapter_id, .. } if adapter_id == "codex"
    ));
    assert_eq!(commit.close_active.unwrap().segment_id, "s0");
    let layout = store.layout.lock().unwrap().clone();
    let borrowed = layout.native("ns_f").unwrap();
    assert_eq!(borrowed.borrowed_from_chat_id.as_deref(), Some("c1"));
    assert!(
        layout
            .handoffs
            .iter()
            .all(|h| h.status != HandoffStatus::Pending)
    );
}
