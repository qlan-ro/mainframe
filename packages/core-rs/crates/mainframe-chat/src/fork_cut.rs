//! `resolve_fork_cut` — maps the chat message id a from-message fork names to
//! the id the provider transcript knows it by. Adapter-neutral and pure:
//! adapters then only have to locate that vendor id in their own transcript.
//!
//! `resolve_segment_fork_cut` narrows both lists to the chat's latest
//! provider segment first, refusing a cut before it. See
//! `docs/specs/2026-10-06-fork-from-message.md` "Resolving the cut" and
//! "Compatibility".

use mainframe_types::chat::{ChatMessage, ChatMessageType};
use mainframe_types::segment::SegmentKind;

use crate::fork::ForkChatError;
use crate::segments::divider::is_divider;
use crate::segments::fork_plan::{marker_of, switch_before};

pub use mainframe_adapter_api::FORK_CUT_NOT_FOUND_REASON as CUT_NOT_FOUND_REASON;

/// Resolve `message_id` (an id from `live`, the chat's displayed messages) to
/// the vendor id of the same user message in `disk` (the chat's transcript as
/// the adapter reloads it).
///
/// The id fast path covers Claude, whose live ids are the transcript `uuid`s.
/// Otherwise the message's ordinal among sent user messages is used, but only
/// when both lists hold the same number of them: failing closed never forks
/// at the wrong point.
pub fn resolve_fork_cut(
    live: &[ChatMessage],
    disk: &[ChatMessage],
    message_id: &str,
) -> Result<String, ForkChatError> {
    let sent = sent_user_messages(live);
    let ordinal = check_cut_message(live, &sent, message_id)?;
    let on_disk: Vec<&ChatMessage> = disk
        .iter()
        .filter(|m| m.r#type == ChatMessageType::User)
        .collect();
    if on_disk.iter().any(|m| m.id == message_id) {
        return Ok(message_id.to_string());
    }
    if on_disk.len() == sent.len() {
        return Ok(on_disk[ordinal].id.clone());
    }
    Err(ForkChatError::ForkPointUnresolved(
        CUT_NOT_FOUND_REASON.to_string(),
    ))
}

/// `resolve_fork_cut` for a chat that may span several provider segments
/// (both lists composed, dividers included). The cut must lie in the latest
/// segment, and not on its first user message: that one carries the handoff,
/// and forking before it means "after the previous provider's last turn".
/// Both lists are then narrowed to that segment, so the ordinal fallback
/// counts only its messages.
pub fn resolve_segment_fork_cut(
    live: &[ChatMessage],
    disk: &[ChatMessage],
    message_id: &str,
) -> Result<String, ForkChatError> {
    let Some(latest) = live.iter().rposition(is_divider) else {
        return resolve_fork_cut(live, disk, message_id);
    };
    check_cut_message(live, &sent_user_messages(live), message_id)?;
    let divider = &live[latest];
    let opens_segment = sent_user_messages(&live[latest + 1..])
        .first()
        .is_some_and(|m| m.id == message_id);
    if switch_before(live, message_id).is_some() || opens_segment {
        return Err(refusal_for(divider));
    }
    let disk_from = disk
        .iter()
        .rposition(|m| m.id == divider.id)
        .map_or(0, |index| index + 1);
    resolve_fork_cut(&live[latest + 1..], &disk[disk_from..], message_id)
}

/// The refusal naming what the latest divider started.
fn refusal_for(divider: &ChatMessage) -> ForkChatError {
    match marker_of(divider) {
        Some(marker) if marker.kind == SegmentKind::ContextReset => {
            ForkChatError::BeforeContextReset
        }
        Some(marker) => ForkChatError::BeforeProviderSwitch(marker.to_adapter_name.clone()),
        None => ForkChatError::ForkPointUnresolved(CUT_NOT_FOUND_REASON.to_string()),
    }
}

fn sent_user_messages(messages: &[ChatMessage]) -> Vec<&ChatMessage> {
    messages
        .iter()
        .filter(|m| m.r#type == ChatMessageType::User && !is_unsent(m))
        .collect()
}

/// The not-found, not-user, unsent and first-message rules, in the daemon
/// contract's order. Returns the message's ordinal among `sent`.
fn check_cut_message(
    live: &[ChatMessage],
    sent: &[&ChatMessage],
    message_id: &str,
) -> Result<usize, ForkChatError> {
    let message = live
        .iter()
        .find(|m| m.id == message_id)
        .ok_or(ForkChatError::MessageNotFound)?;
    if message.r#type != ChatMessageType::User {
        return Err(ForkChatError::NotAUserMessage);
    }
    if is_unsent(message) {
        return Err(ForkChatError::MessageNotSent);
    }
    match sent.iter().position(|m| m.id == message_id) {
        None => Err(ForkChatError::MessageNotFound),
        Some(0) => Err(ForkChatError::NothingBeforeMessage),
        Some(ordinal) => Ok(ordinal),
    }
}

/// A queued send has not reached the provider as its own turn yet, and a
/// client-pending or failed send never left the composer, so none of them
/// marks a point in the transcript. The daemon only ever stores `queued`; the
/// other two flags are the UI projection's and are checked so a message that
/// carries them can never be mistaken for a sent one.
fn is_unsent(message: &ChatMessage) -> bool {
    let Some(metadata) = message.metadata.as_ref() else {
        return false;
    };
    let flag = |key: &str| metadata.get(key).and_then(serde_json::Value::as_bool) == Some(true);
    flag("queued") || flag("pending") || metadata.contains_key("error")
}

#[cfg(test)]
#[path = "fork_cut_tests.rs"]
mod tests;
