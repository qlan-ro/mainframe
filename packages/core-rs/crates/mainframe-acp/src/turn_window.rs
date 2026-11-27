//! History windows sized by whole turns.
//!
//! A request that sets `turns` asks for the last N turns instead of a count of
//! containers or items. A turn starts at a visible user message or at the first
//! container of a hidden-prompt group (a task notification the provider answered
//! on its own); everything up to the next start belongs to it. A queued prompt is
//! not in the transcript yet, a steered one continues the turn it interrupts, and
//! a compaction marker leads the turn that follows it.
//!
//! One safety rule bounds the wire: when the selected turns encode to more than
//! [`MAX_WINDOW_BYTES`], whole turns drop from the top, always keeping one.

use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayMessageType, DisplayNode};

use crate::EncodedItem;

pub const DEFAULT_TURNS: usize = 10;
/// About 1 MB of encoded JSON: above it the oldest whole turns drop.
pub const MAX_WINDOW_BYTES: usize = 1_000_000;

pub fn turn_count(turns: i64) -> usize {
    turns.clamp(1, 200) as usize
}

fn flag(message: &DisplayMessage, key: &str) -> bool {
    message
        .metadata
        .as_ref()
        .and_then(|meta| meta.get(key))
        .and_then(serde_json::Value::as_bool)
        == Some(true)
}

fn text_meta<'a>(message: &'a DisplayMessage, key: &str) -> Option<&'a str> {
    message
        .metadata
        .as_ref()
        .and_then(|meta| meta.get(key))
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
}

fn is_compaction_marker(message: &DisplayMessage) -> bool {
    message.r#type == DisplayMessageType::System
        && !message.content.is_empty()
        && message
            .content
            .iter()
            .all(|block| matches!(block, DisplayContent::Node(DisplayNode::Compaction { .. })))
}

/// Whether container `index` of `messages` starts a turn.
pub fn is_turn_start(messages: &[DisplayMessage], index: usize) -> bool {
    let message = &messages[index];
    match message.r#type {
        DisplayMessageType::User => !flag(message, "queued") && !flag(message, "steered"),
        DisplayMessageType::Assistant => {
            if text_meta(message, "hiddenPromptEvent").is_some() {
                return true;
            }
            let group = text_meta(message, "turnGroup");
            let previous = index
                .checked_sub(1)
                .map(|prev| &messages[prev])
                .filter(|prev| prev.r#type == DisplayMessageType::Assistant)
                .and_then(|prev| text_meta(prev, "turnGroup"));
            matches!((group, previous), (Some(group), Some(previous)) if group != previous)
        }
        _ => false,
    }
}

/// Where the window of the last `turns` turns before container `end` starts: the
/// first container of the Nth turn back, led by the compaction markers just
/// before it. Zero when fewer turns exist.
pub fn start_before(messages: &[DisplayMessage], end: usize, turns: usize) -> usize {
    let mut remaining = turns.max(1);
    for index in (0..end.min(messages.len())).rev() {
        if !is_turn_start(messages, index) {
            continue;
        }
        remaining -= 1;
        if remaining == 0 {
            return lead_markers(messages, index);
        }
    }
    0
}

fn lead_markers(messages: &[DisplayMessage], mut start: usize) -> usize {
    while start > 0 && is_compaction_marker(&messages[start - 1]) {
        start -= 1;
    }
    start
}

/// Turn starts among `messages`, for a partial list that must hold `turns` of them.
pub fn count_turns(messages: &[DisplayMessage]) -> usize {
    (0..messages.len())
        .filter(|&index| is_turn_start(messages, index))
        .count()
}

struct Counter(usize);

impl std::io::Write for Counter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0 += buf.len();
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Encoded size of `items` as JSON, counted without building the string.
pub fn encoded_bytes(items: &[EncodedItem]) -> usize {
    let mut counter = Counter(0);
    if let Err(error) = serde_json::to_writer(&mut counter, items) {
        tracing::warn!(error = %error, "could not measure an encoded window");
    }
    counter.0
}

/// Drop whole turns from the top of `containers` (container `start` onward of
/// `messages`) while they encode to more than `limit` bytes, keeping the newest
/// turn. Returns the new start.
pub fn fit(
    messages: &[DisplayMessage],
    start: usize,
    containers: &mut Vec<Vec<EncodedItem>>,
    limit: usize,
) -> usize {
    let sizes: Vec<usize> = containers
        .iter()
        .map(|items| encoded_bytes(items))
        .collect();
    let mut total: usize = sizes.iter().sum();
    let mut first = 0;
    while total > limit {
        // The next turn start after `first`, and the markers that lead it.
        let Some(next) = (first + 1..containers.len())
            .find(|&offset| is_turn_start(messages, start + offset))
            .map(|offset| {
                lead_markers(messages, start + offset)
                    .saturating_sub(start)
                    .max(first + 1)
            })
        else {
            break;
        };
        total -= sizes[first..next].iter().sum::<usize>();
        first = next;
    }
    containers.drain(..first);
    start + first
}

#[cfg(test)]
#[path = "turn_window_tests.rs"]
mod tests;
