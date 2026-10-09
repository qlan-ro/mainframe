//! Segment helpers for the fork features: which parent segments a fork
//! copies and how (`fork_plan`), and whether a fork point lies before the
//! latest segment (`switch_before`). Pure; the fork features own pinning and
//! row insertion.

use mainframe_types::chat::{ChatMessage, MessageContent, MessageContentNode};
pub use mainframe_types::segment::{ForkPlan, ForkSegmentPlan, ForkSegmentRole};
use mainframe_types::segment::{ProviderSwitchMarker, SegmentLayout};

use super::divider::is_divider;
use super::switch_plan::is_pending_empty;

/// Where a fork cuts the parent: before `message_id` in `segment_id`, or at
/// the current end when `message_id` is `None`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForkPoint {
    pub segment_id: String,
    pub message_id: Option<String>,
}

/// `can_pin`: the adapter can pin a native fork at the cut point.
pub fn fork_plan(parent: &SegmentLayout, point: &ForkPoint, can_pin: bool) -> Option<ForkPlan> {
    let k = parent
        .segments
        .iter()
        .position(|s| s.id == point.segment_id)?;
    let target = &parent.segments[k];
    let whole_chat_pending = point.message_id.is_none() && is_pending_empty(parent, target);
    let pinned_native = (!whole_chat_pending && can_pin).then(|| target.native_session_ref.clone());
    let kept = if whole_chat_pending {
        &parent.segments[..k]
    } else {
        &parent.segments[..=k]
    };
    let segments = kept
        .iter()
        .map(|s| {
            let role = if pinned_native.as_deref() == Some(s.native_session_ref.as_str()) {
                ForkSegmentRole::Pinned
            } else if s.id == target.id {
                ForkSegmentRole::Borrowed {
                    end_message_id: point.message_id.clone(),
                    end_at: None,
                }
            } else {
                // A segment the parent itself borrows keeps its own, tighter
                // bound (a fork of a fork).
                ForkSegmentRole::Borrowed {
                    end_message_id: s
                        .end_bound_message_id
                        .clone()
                        .or_else(|| s.last_message_id.clone()),
                    end_at: s.end_bound_at.clone().or_else(|| s.closed_at.clone()),
                }
            };
            ForkSegmentPlan {
                source_segment_id: s.id.clone(),
                ordinal: s.ordinal,
                kind: s.kind,
                role,
            }
        })
        .collect();
    Some(ForkPlan {
        segments,
        pending_active: pinned_native.is_none(),
    })
}

/// The divider marker a message carries, if it is a divider.
pub fn marker_of(message: &ChatMessage) -> Option<&ProviderSwitchMarker> {
    message.content.iter().find_map(|block| match block {
        MessageContent::Node(MessageContentNode::ProviderSwitch { marker }) => Some(marker),
        _ => None,
    })
}

/// The latest divider's marker when `message_id` sits before it in the
/// composed history — "fork from here" refuses such a message, naming
/// `marker.to_adapter_name`. `None` when the message is in the latest
/// segment (or not found).
pub fn switch_before<'a>(
    messages: &'a [ChatMessage],
    message_id: &str,
) -> Option<&'a ProviderSwitchMarker> {
    let latest = messages.iter().rposition(is_divider)?;
    let index = messages.iter().position(|m| m.id == message_id)?;
    (index < latest)
        .then(|| marker_of(&messages[latest]))
        .flatten()
}
