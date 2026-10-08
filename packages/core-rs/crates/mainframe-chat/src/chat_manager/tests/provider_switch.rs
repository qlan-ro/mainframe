//! Provider switch end to end over a real `ChatManager` with an in-memory
//! segment store: the switch kills the CLI, spawns nothing and appends the
//! divider; the next send carries the handoff block while the stored message
//! keeps only the user's text; the turn result marks the handoff delivered.

use mainframe_types::adapter::{AdapterInfo, SessionResult};
use mainframe_types::segment::{
    HandoffStatus, OpenNative, SegmentKind, SegmentLayout, SwitchProviderRequest,
};

use super::segment_fake::{FakeStore, native, segment};
use super::*;

pub(super) fn codex_info() -> AdapterInfo {
    serde_json::from_value(serde_json::json!({
        "id": "codex", "name": "codex", "description": "", "installed": true,
        "models": [{"id": "codex-pro", "label": "Pro"}],
        "capabilities": {"planMode": true, "autoMode": false}
    }))
    .unwrap()
}

/// An adapter with no plan mode at all, for the narrowing test below.
pub(super) fn no_plan_mode_info() -> AdapterInfo {
    serde_json::from_value(serde_json::json!({
        "id": "noplan", "name": "noplan", "description": "", "installed": true,
        "models": [{"id": "default", "label": "Default"}],
        "capabilities": {"planMode": false, "autoMode": false}
    }))
    .unwrap()
}

pub(super) fn text_message(id: &str, kind: ChatMessageType, text: &str) -> ChatMessage {
    ChatMessage {
        id: id.into(),
        chat_id: "c1".into(),
        r#type: kind,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: text.into(),
            parent_tool_use_id: None,
        })],
        timestamp: "2026-10-06T00:00:00Z".into(),
        metadata: None,
    }
}

fn setup(layout: SegmentLayout, adapter: &str) -> (Arc<StoreDeps>, Arc<FakeStore>, ChatManager) {
    let mut chat = test_chat("c1");
    chat.adapter_id = adapter.into();
    chat.claude_session_id = (adapter == "claude").then(|| "c-1".to_string());
    let deps = StoreDeps::with_chats(vec![chat.clone()]);
    let store = Arc::new(FakeStore {
        layout: Mutex::new(layout),
        ..Default::default()
    });
    deps.set_segment_store(store.clone());
    deps.set_adapter_info(codex_info());
    let mgr = ChatManager::new(deps.clone());
    mgr.messages.lock().unwrap().set(
        "c1",
        vec![
            text_message("u1", ChatMessageType::User, "first question"),
            text_message("a1", ChatMessageType::Assistant, "first answer"),
        ],
    );
    (deps, store, mgr)
}

#[tokio::test]
async fn switching_kills_the_cli_spawns_nothing_and_appends_the_divider() {
    let mut layout = SegmentLayout {
        segments: vec![segment("s0", 0, "ns_c", SegmentKind::Initial)],
        natives: vec![native("ns_c", "claude", Some("c-1"))],
        handoffs: vec![],
    };
    layout.segments[0].closed_at = None;
    layout.segments[0].turn_count = 1;
    let (_deps, store, mgr) = setup(layout, "claude");
    let session = RecSession::new("old", false, true);
    seed_active(&mgr, "c1", mgr.get_chat("c1").unwrap(), session.clone());

    let req = SwitchProviderRequest {
        adapter_id: "codex".into(),
        model: Some("codex-pro".into()),
        tuning: None,
    };
    mgr.switch_provider("c1", &req).await.unwrap();

    assert_eq!(session.kills.load(Ordering::SeqCst), 1);
    assert!(
        mgr.get_active("c1")
            .unwrap()
            .lock()
            .unwrap()
            .session
            .is_none()
    );
    let commit = store.commits.lock().unwrap()[0].clone();
    assert_eq!(commit.close_active.unwrap().segment_id, "s0");
    let open = commit.open_segment.unwrap();
    assert!(
        matches!(open.native, OpenNative::Fresh { ref adapter_id, .. } if adapter_id == "codex")
    );
    assert_eq!(commit.settings.model.as_deref(), Some("codex-pro"));
    let cached = mgr.messages.lock().unwrap().get("c1").cloned().unwrap();
    assert_eq!(cached.last().unwrap().id, format!("segdiv-{}", open.id));
}

#[tokio::test]
async fn the_first_send_carries_the_block_and_the_result_delivers_it() {
    let mut layout = SegmentLayout {
        segments: vec![
            segment("s0", 0, "ns_c", SegmentKind::Initial),
            segment("s1", 1, "ns_x", SegmentKind::ProviderSwitch),
        ],
        natives: vec![
            native("ns_c", "claude", Some("c-1")),
            native("ns_x", "codex", None),
        ],
        handoffs: vec![],
    };
    layout.segments[1].closed_at = None;
    let (_deps, store, mgr) = setup(layout.clone(), "codex");
    let name_of = |id: &str| id.to_string();
    let divider = crate::segments::divider::divider_for("c1", &layout, "s1", &name_of).unwrap();
    mgr.messages.lock().unwrap().append("c1", divider);
    let session = RecSession::new("codex", false, true);
    seed_active(&mgr, "c1", mgr.get_chat("c1").unwrap(), session.clone());

    mgr.send_message("c1", "next step", None, None)
        .await
        .unwrap();

    let (sent, _) = session.send_message_calls.lock().unwrap()[0].clone();
    assert!(
        sent.starts_with("<mainframe-context-handoff segment=\"s1\""),
        "{sent}"
    );
    assert!(sent.contains("[user · turn 1 · claude]\nfirst question"));
    assert!(sent.ends_with("</mainframe-context-handoff>\n\nnext step"));
    let cached = mgr.messages.lock().unwrap().get("c1").cloned().unwrap();
    let stored = cached
        .iter()
        .rev()
        .find(|m| m.r#type == ChatMessageType::User)
        .unwrap();
    assert!(
        matches!(&stored.content[0], MessageContent::Leaf(LeafContent::Text { text, .. }) if text == "next step")
    );
    let pending = store.layout.lock().unwrap().handoffs[0].clone();
    assert_eq!(
        (pending.status, pending.item_count, pending.omitted_count),
        (HandoffStatus::Pending, 2, 0)
    );

    let sink = mgr.event_handler.build_sink("c1", None);
    sink.on_result(SessionResult {
        total_cost_usd: Some(0.0),
        usage: None,
        context_tokens: None,
        subtype: None,
        result: None,
        is_error: None,
    });
    assert_eq!(
        store.layout.lock().unwrap().handoffs[0].status,
        HandoffStatus::Delivered
    );
    assert_eq!(store.results.lock().unwrap().len(), 1);
    let refreshed = mgr.messages.lock().unwrap().get("c1").cloned().unwrap();
    let divider = refreshed.iter().find(|m| m.id == "segdiv-s1").unwrap();
    let MessageContent::Node(mainframe_types::chat::MessageContentNode::ProviderSwitch { marker }) =
        &divider.content[0]
    else {
        panic!("divider content");
    };
    assert_eq!(
        marker.handoff.as_ref().map(|h| h.status),
        Some(HandoffStatus::Delivered)
    );
}

/// A switch before the first message is sent bypasses `plan_switch` (no
/// native session exists yet to plan against) and writes the config
/// directly. It must still apply the same narrowing rule `plan_switch` uses
/// (spec "Plan mode: kept when `capabilities.planMode`, else `false`"),
/// not silently leave plan mode on for a target that cannot honor it.
#[tokio::test]
async fn a_switch_before_the_first_message_clears_plan_mode_the_target_cannot_support() {
    let layout = SegmentLayout {
        segments: vec![segment("s0", 0, "ns_c", SegmentKind::Initial)],
        natives: vec![native("ns_c", "claude", None)],
        handoffs: vec![],
    };
    let mut chat = test_chat("c1");
    chat.adapter_id = "claude".into();
    chat.plan_mode = Some(true);
    let deps = StoreDeps::with_chats(vec![chat]);
    let store = Arc::new(FakeStore {
        layout: Mutex::new(layout),
        ..Default::default()
    });
    deps.set_segment_store(store.clone());
    deps.set_adapter_info(no_plan_mode_info());
    let mgr = ChatManager::new(deps.clone());

    let req = SwitchProviderRequest {
        adapter_id: "noplan".into(),
        model: Some("default".into()),
        tuning: None,
    };
    let chat = mgr.switch_provider("c1", &req).await.unwrap();

    assert_eq!(chat.adapter_id, "noplan");
    assert_eq!(
        chat.plan_mode,
        Some(false),
        "plan mode must be cleared, not left on, for a target without planMode"
    );
}
