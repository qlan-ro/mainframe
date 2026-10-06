//! `resolve_fork_cut` — maps the chat message id a from-message fork names to
//! the id the provider transcript knows it by. Adapter-neutral and pure:
//! adapters then only have to locate that vendor id in their own transcript.
//!
//! The lists are slices so a caller can narrow both to one stretch of the
//! conversation first (e.g. only the latest provider segment) without this
//! function changing. See `docs/specs/2026-10-06-fork-from-message.md`
//! "Resolving the cut".

use mainframe_types::chat::{ChatMessage, ChatMessageType};

use crate::fork::ForkChatError;

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
    let sent: Vec<&ChatMessage> = live
        .iter()
        .filter(|m| m.r#type == ChatMessageType::User && !is_unsent(m))
        .collect();
    let ordinal = sent
        .iter()
        .position(|m| m.id == message_id)
        .ok_or(ForkChatError::MessageNotFound)?;
    if ordinal == 0 {
        return Err(ForkChatError::NothingBeforeMessage);
    }

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
