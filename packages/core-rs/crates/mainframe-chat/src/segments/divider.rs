//! The divider every segment after a chat's first opens with. One builder
//! serves both paths: live (appended at switch time, updated in place when
//! its handoff is built or delivered) and cold (rebuilt during composition).

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::segment::{
    HandoffRecord, ProviderSwitchMarker, SegmentLayout, SegmentRecord, SegmentTotals,
};

/// Deterministic, so live and cold dividers share one id.
pub fn divider_id(segment_id: &str) -> String {
    format!("segdiv-{segment_id}")
}

pub fn is_divider(message: &ChatMessage) -> bool {
    message.id.starts_with("segdiv-")
}

fn adapter_of(layout: &SegmentLayout, segment: &SegmentRecord) -> String {
    layout
        .native(&segment.native_session_ref)
        .map(|n| n.adapter_id.clone())
        .unwrap_or_default()
}

fn totals(layout: &SegmentLayout, segment: &SegmentRecord) -> SegmentTotals {
    let native = layout.native(&segment.native_session_ref);
    SegmentTotals {
        adapter_id: adapter_of(layout, segment),
        model: native.and_then(|n| n.model.clone()),
        turn_count: segment.turn_count,
        total_cost: segment.total_cost,
        total_tokens_input: segment.total_tokens_input,
        total_tokens_output: segment.total_tokens_output,
    }
}

/// `None` for the chat's first segment (it has no divider) or an unknown id.
pub fn build_marker(
    layout: &SegmentLayout,
    segment_id: &str,
    name_of: &dyn Fn(&str) -> String,
) -> Option<ProviderSwitchMarker> {
    let index = layout.segments.iter().position(|s| s.id == segment_id)?;
    let previous = layout.segments.get(index.checked_sub(1)?)?;
    let segment = &layout.segments[index];
    let from = adapter_of(layout, previous);
    let to = adapter_of(layout, segment);
    let resumed = layout.segments[..index]
        .iter()
        .any(|s| s.native_session_ref == segment.native_session_ref);
    Some(ProviderSwitchMarker {
        segment_id: segment.id.clone(),
        kind: segment.kind,
        from_adapter_name: name_of(&from),
        to_adapter_name: name_of(&to),
        from_adapter_id: from,
        to_adapter_id: to,
        to_model: layout
            .native(&segment.native_session_ref)
            .and_then(|n| n.model.clone()),
        resumed,
        previous: totals(layout, previous),
        handoff: layout.handoff_for(&segment.id).map(HandoffRecord::summary),
    })
}

pub fn divider_message(
    chat_id: &str,
    marker: ProviderSwitchMarker,
    timestamp: &str,
) -> ChatMessage {
    ChatMessage {
        id: divider_id(&marker.segment_id),
        chat_id: chat_id.to_string(),
        r#type: ChatMessageType::System,
        content: vec![MessageContent::Node(MessageContentNode::ProviderSwitch {
            marker,
        })],
        timestamp: timestamp.to_string(),
        metadata: None,
    }
}

/// The divider for `segment_id`, if it has one.
pub fn divider_for(
    chat_id: &str,
    layout: &SegmentLayout,
    segment_id: &str,
    name_of: &dyn Fn(&str) -> String,
) -> Option<ChatMessage> {
    let marker = build_marker(layout, segment_id, name_of)?;
    let created_at = layout
        .segments
        .iter()
        .find(|s| s.id == segment_id)
        .map(|s| s.created_at.clone())
        .unwrap_or_default();
    Some(divider_message(chat_id, marker, &created_at))
}

/// Rebuilds a segment's divider from `layout` in the cache (its handoff was
/// built or delivered). Returns whether the cached divider changed.
pub fn refresh_divider(
    messages: &std::sync::Mutex<crate::message_cache::MessageCache>,
    store: &dyn super::SegmentStore,
    chat_id: &str,
    segment_id: &str,
    name_of: &dyn Fn(&str) -> String,
) -> bool {
    let Some(layout) = store.layout(chat_id) else {
        return false;
    };
    let Some(fresh) = divider_for(chat_id, &layout, segment_id, name_of) else {
        return false;
    };
    let id = divider_id(segment_id);
    messages
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .update_in_place(chat_id, |m| {
            if m.id != id || m.content == fresh.content {
                return false;
            }
            m.content = fresh.content.clone();
            true
        })
}
