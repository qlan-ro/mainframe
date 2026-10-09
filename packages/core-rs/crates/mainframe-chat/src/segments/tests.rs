//! Shared fixtures for the segment tests; each concern has its own file.

mod compose_tests;
mod fork_borrow_tests;
mod fork_plan_tests;
mod switch_plan_tests;
mod switch_rules_tests;

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;
use mainframe_types::segment::{
    HandoffRecord, HandoffStatus, HandoffStrategy, NativeSessionRecord, SegmentKind, SegmentLayout,
    SegmentRecord,
};

pub(super) fn native(id: &str, adapter: &str, native_id: Option<&str>) -> NativeSessionRecord {
    NativeSessionRecord {
        id: id.into(),
        chat_id: "chat_1".into(),
        adapter_id: adapter.into(),
        native_session_id: native_id.map(str::to_string),
        ..Default::default()
    }
}

pub(super) fn segment(id: &str, ordinal: u32, native: &str, kind: SegmentKind) -> SegmentRecord {
    SegmentRecord {
        id: id.into(),
        chat_id: "chat_1".into(),
        ordinal,
        native_session_ref: native.into(),
        kind,
        start_marker: (ordinal > 0).then(|| id.to_string()),
        closed_at: Some(format!("2026-10-06T0{ordinal}:59:00Z")),
        created_at: format!("2026-10-06T0{ordinal}:00:00Z"),
        ..Default::default()
    }
}

pub(super) fn handoff(segment_id: &str, status: HandoffStatus) -> HandoffRecord {
    HandoffRecord {
        id: format!("ho_{segment_id}"),
        chat_id: "chat_1".into(),
        target_segment_id: segment_id.into(),
        strategy: HandoffStrategy::Full,
        covered_from_ordinal: 0,
        covered_to_ordinal: 0,
        item_count: 2,
        omitted_count: 0,
        budget_bytes: 16_000,
        used_bytes: 500,
        fell_back_to_fresh: false,
        status,
        created_at: "t".into(),
        delivered_at: None,
    }
}

/// Claude (ns_c) → Codex (ns_x) → Claude again (ns_c); the last is active.
pub(super) fn c_x_c() -> SegmentLayout {
    let mut segments = vec![
        segment("s0", 0, "ns_c", SegmentKind::Initial),
        segment("s1", 1, "ns_x", SegmentKind::ProviderSwitch),
        segment("s2", 2, "ns_c", SegmentKind::ProviderSwitch),
    ];
    segments[2].closed_at = None;
    SegmentLayout {
        segments,
        natives: vec![
            native("ns_c", "claude", Some("c-1")),
            native("ns_x", "codex", Some("x-1")),
        ],
        handoffs: vec![
            handoff("s1", HandoffStatus::Delivered),
            handoff("s2", HandoffStatus::Delivered),
        ],
    }
}

pub(super) fn user(id: &str, text: &str) -> ChatMessage {
    message(id, ChatMessageType::User, text)
}

pub(super) fn assistant(id: &str, text: &str) -> ChatMessage {
    message(id, ChatMessageType::Assistant, text)
}

fn message(id: &str, kind: ChatMessageType, text: &str) -> ChatMessage {
    ChatMessage {
        id: id.into(),
        chat_id: "chat_1".into(),
        r#type: kind,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: text.into(),
            parent_tool_use_id: None,
        })],
        timestamp: "2026-10-06T00:00:00Z".into(),
        metadata: None,
    }
}

/// A user message whose text opens with the handoff block for `segment`.
pub(super) fn marked_user(id: &str, segment: &str, text: &str) -> ChatMessage {
    user(
        id,
        &format!(
            "<mainframe-context-handoff segment=\"{segment}\" handoff=\"h\" strategy=\"full\">\nctx\n</mainframe-context-handoff>\n\n{text}"
        ),
    )
}

pub(super) fn text_of(message: &ChatMessage) -> &str {
    match &message.content[0] {
        MessageContent::Leaf(LeafContent::Text { text, .. }) => text,
        _ => "",
    }
}

pub(super) fn name_of(adapter: &str) -> String {
    match adapter {
        "claude" => "Claude".into(),
        "codex" => "Codex".into(),
        other => other.into(),
    }
}
