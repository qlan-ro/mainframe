//! Provider switch end to end over a real `ChatManager` with an in-memory
//! segment store: the switch kills the CLI, spawns nothing and appends the
//! divider; the next send carries the handoff block while the stored message
//! keeps only the user's text; the turn result marks the handoff delivered.

use mainframe_types::adapter::{AdapterInfo, SessionResult};
use mainframe_types::segment::{
    HandoffRecord, HandoffStatus, NativeSessionRecord, OpenNative, SegmentKind, SegmentLayout,
    SegmentRecord, SegmentResultDelta, SwitchCommit, SwitchProviderRequest,
};

use super::*;
use crate::segments::SegmentStore;

#[derive(Default)]
struct FakeStore {
    layout: Mutex<SegmentLayout>,
    commits: Mutex<Vec<SwitchCommit>>,
    results: Mutex<Vec<SegmentResultDelta>>,
}

impl FakeStore {
    fn apply(&self, c: &SwitchCommit) {
        let mut l = self.layout.lock().unwrap();
        if let Some(p) = &c.delete_pending {
            l.segments.retain(|s| s.id != p.segment_id);
        }
        for s in &mut l.segments {
            if c.close_active
                .as_ref()
                .is_some_and(|x| x.segment_id == s.id)
            {
                s.closed_at = Some(c.now.clone());
            }
            if c.reactivate_segment_id.as_deref() == Some(s.id.as_str()) {
                s.closed_at = None;
            }
        }
        if let Some(open) = &c.open_segment {
            let native_ref = match &open.native {
                OpenNative::Existing(id) => id.clone(),
                OpenNative::Fresh { id, adapter_id } => {
                    l.natives.push(native(id, adapter_id, None));
                    id.clone()
                }
            };
            let mut seg = segment(&open.id, open.ordinal, &native_ref, open.kind);
            seg.closed_at = None;
            l.segments.push(seg);
        }
    }
}

impl SegmentStore for FakeStore {
    fn layout(&self, _chat_id: &str) -> Option<SegmentLayout> {
        Some(self.layout.lock().unwrap().clone())
    }
    fn commit_switch(&self, commit: &SwitchCommit) -> Result<SegmentLayout, String> {
        self.commits.lock().unwrap().push(commit.clone());
        self.apply(commit);
        Ok(self.layout.lock().unwrap().clone())
    }
    fn replace_active_native(&self, _chat_id: &str) -> Result<SegmentLayout, String> {
        Err("not expected in these tests".into())
    }
    fn insert_pending_handoff(&self, record: &HandoffRecord, marker: &str) -> Result<(), String> {
        let mut l = self.layout.lock().unwrap();
        l.handoffs
            .retain(|h| h.target_segment_id != record.target_segment_id);
        l.handoffs.push(record.clone());
        if let Some(s) = l
            .segments
            .iter_mut()
            .find(|s| s.id == record.target_segment_id)
        {
            s.start_marker.get_or_insert_with(|| marker.to_string());
        }
        Ok(())
    }
    fn set_handoff_status(&self, handoff_id: &str, status: HandoffStatus) -> bool {
        let mut l = self.layout.lock().unwrap();
        let Some(h) = l.handoffs.iter_mut().find(|h| h.id == handoff_id) else {
            return false;
        };
        h.status = status;
        true
    }
    fn add_result(&self, _chat_id: &str, delta: &SegmentResultDelta) {
        self.results.lock().unwrap().push(delta.clone());
    }
    fn has_native_id(&self, _chat_id: &str) -> bool {
        let l = self.layout.lock().unwrap();
        l.natives.iter().any(|n| n.native_session_id.is_some())
    }
}

fn native(id: &str, adapter: &str, native_id: Option<&str>) -> NativeSessionRecord {
    NativeSessionRecord {
        id: id.into(),
        adapter_id: adapter.into(),
        native_session_id: native_id.map(str::to_string),
        ..Default::default()
    }
}

fn segment(id: &str, ordinal: u32, native: &str, kind: SegmentKind) -> SegmentRecord {
    SegmentRecord {
        id: id.into(),
        ordinal,
        native_session_ref: native.into(),
        kind,
        closed_at: Some("t".into()),
        created_at: "2026-10-06T00:00:00Z".into(),
        ..Default::default()
    }
}

fn codex_info() -> AdapterInfo {
    serde_json::from_value(serde_json::json!({
        "id": "codex", "name": "codex", "description": "", "installed": true,
        "models": [{"id": "codex-pro", "label": "Pro"}],
        "capabilities": {"planMode": true, "autoMode": false}
    }))
    .unwrap()
}

fn text_message(id: &str, kind: ChatMessageType, text: &str) -> ChatMessage {
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
