//! The Claude side of a from-message fork: find where the chosen user message
//! starts in the parent's transcript, so `fork::pin_fork_point` can snapshot
//! only the lines before it. Resuming that prefix with `--fork-session` picks
//! the message's `parentUuid` as the leaf (the latest chain entry), which is
//! the conversation exactly as it stood when the message was sent.
//!
//! See `docs/specs/2026-10-06-fork-from-message.md` "Claude: pin a prefix
//! snapshot" and `docs/research/adapters/claude/SESSIONS_JSONL.md`.

use mainframe_adapter_api::{FORK_CUT_NOT_FOUND_REASON, ForkPinError};
use serde_json::Value;

/// A queued send the CLI folded into a running turn is written as a
/// `queued_command` attachment, not a user turn, so nothing ends right before it.
pub(crate) const JOINED_TURN_REASON: &str =
    "This message joined a turn that was already running, so it can't be a fork point";

/// Entry types that form the conversation chain a resume walks. A prefix
/// without one of them would resume into an empty conversation.
const CHAIN_TYPES: [&str; 4] = ["user", "assistant", "system", "attachment"];

/// What one transcript line means for the cut.
enum LineMatch {
    /// The cut message itself: the prefix ends where this line starts.
    Turn,
    /// The message was absorbed into a running turn.
    JoinedTurn,
    /// Not the cut message (or a same-uuid line that isn't a turn boundary).
    Other,
}

/// Byte length of the transcript prefix that ends right before the user
/// message whose entry `uuid` is `vendor_message_id`. `bytes` must hold
/// complete lines only (the caller trims a trailing partial line first).
pub(crate) fn prefix_len_before_message(
    bytes: &[u8],
    vendor_message_id: &str,
) -> Result<usize, ForkPinError> {
    let mut offset = 0;
    let mut has_chain_entry = false;
    for line in bytes.split_inclusive(|&b| b == b'\n') {
        let entry: Option<Value> = serde_json::from_slice(line).ok();
        if let Some(entry) = entry.as_ref() {
            match classify(entry, vendor_message_id) {
                LineMatch::Turn if has_chain_entry => return Ok(offset),
                LineMatch::Turn => return Err(not_found()),
                LineMatch::JoinedTurn => {
                    return Err(ForkPinError::PointNotFound(JOINED_TURN_REASON.to_string()));
                }
                LineMatch::Other => has_chain_entry |= is_chain_entry(entry),
            }
        }
        offset += line.len();
    }
    Err(not_found())
}

fn not_found() -> ForkPinError {
    ForkPinError::PointNotFound(FORK_CUT_NOT_FOUND_REASON.to_string())
}

fn classify(entry: &Value, vendor_message_id: &str) -> LineMatch {
    if entry.get("uuid").and_then(Value::as_str) != Some(vendor_message_id) {
        return LineMatch::Other;
    }
    match entry.get("type").and_then(Value::as_str) {
        Some("attachment") => LineMatch::JoinedTurn,
        Some("user") if is_turn_start(entry) => LineMatch::Turn,
        _ => LineMatch::Other,
    }
}

/// A `user` entry starts a turn only when it is the main chain's own prompt:
/// subagent (`isSidechain`) and injected (`isMeta`) lines share the type, and a
/// tool result is a `user` entry the CLI writes mid-turn.
fn is_turn_start(entry: &Value) -> bool {
    let flag = |key: &str| entry.get(key).and_then(Value::as_bool) == Some(true);
    !flag("isSidechain") && !flag("isMeta") && !is_only_tool_results(entry)
}

fn is_only_tool_results(entry: &Value) -> bool {
    let Some(blocks) = entry.pointer("/message/content").and_then(Value::as_array) else {
        return false;
    };
    !blocks.is_empty()
        && blocks
            .iter()
            .all(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
}

fn is_chain_entry(entry: &Value) -> bool {
    entry
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|t| CHAIN_TYPES.contains(&t))
}

#[cfg(test)]
#[path = "fork_cut_tests.rs"]
mod tests;
