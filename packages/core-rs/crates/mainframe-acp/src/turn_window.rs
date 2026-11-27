//! History windows sized by whole turns.
//!
//! A request that sets `turns` asks for the last N turns instead of a count of
//! containers or items. A turn is the span from one visible user message to the
//! next: a queued prompt (not in the transcript yet) and a steered one (it joins
//! the turn it interrupts) are not boundaries. Everything up to the next boundary,
//! background-task replies included, counts as one turn, so a window always starts
//! at a real user message and never mid-turn. A compaction or provider-switch
//! marker leads the turn after it.
//!
//! One safety rule bounds the wire: when the selected turns would send more than
//! [`MAX_WINDOW_BYTES`], whole turns drop from the top, always keeping the newest;
//! a single turn over the limit is sent whole.

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::tool_call::ToolCallContent;
use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayMessageType, DisplayNode};

use crate::EncodedItem;

pub const DEFAULT_TURNS: usize = 10;
/// About 1 MB of JSON as sent: above it the oldest whole turns drop.
pub const MAX_WINDOW_BYTES: usize = 1_000_000;
/// What a lazily referenced tool image costs on the wire in place of its base64.
const IMAGE_REFERENCE_BYTES: usize = 128;

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

fn has_node(message: &DisplayMessage, wanted: fn(&DisplayNode) -> bool) -> bool {
    message.r#type == DisplayMessageType::System
        && !message.content.is_empty()
        && message
            .content
            .iter()
            .all(|block| matches!(block, DisplayContent::Node(node) if wanted(node)))
}

fn is_lead_marker(message: &DisplayMessage) -> bool {
    has_node(message, |node| {
        matches!(
            node,
            DisplayNode::Compaction { .. } | DisplayNode::ProviderSwitch { .. }
        )
    })
}

/// Which containers of `messages` are turn boundaries.
pub fn turn_starts(messages: &[DisplayMessage]) -> Vec<bool> {
    messages
        .iter()
        .map(|message| {
            message.r#type == DisplayMessageType::User
                && !flag(message, "queued")
                && !flag(message, "steered")
        })
        .collect()
}

/// Turn starts and the window rules built on them, for one transcript.
pub struct TurnIndex<'a> {
    messages: &'a [DisplayMessage],
    starts: Vec<bool>,
}

impl<'a> TurnIndex<'a> {
    pub fn new(messages: &'a [DisplayMessage]) -> Self {
        Self {
            messages,
            starts: turn_starts(messages),
        }
    }

    pub fn count(&self) -> usize {
        self.starts.iter().filter(|&&start| start).count()
    }

    pub fn is_start(&self, index: usize) -> bool {
        self.starts.get(index).copied().unwrap_or(false)
    }

    /// Whether a window can start at `index`: a turn start, the markers leading
    /// one, or the end of the transcript.
    fn is_boundary(&self, index: usize) -> bool {
        let mut next = index;
        while next < self.messages.len()
            && !self.starts[next]
            && is_lead_marker(&self.messages[next])
        {
            next += 1;
        }
        next >= self.messages.len() || self.starts[next]
    }

    /// The first container of a turn: its turn start, led by the markers just
    /// before it.
    fn boundary(&self, start: usize) -> usize {
        let mut first = start;
        while first > 0 && is_lead_marker(&self.messages[first - 1]) {
            first -= 1;
        }
        first
    }

    /// Where a window of the last `turns` turns before container `end` starts.
    /// When `end` sits inside a turn (a floor left mid-turn), that turn's earlier
    /// part comes along without counting as one of the `turns`. Zero when fewer
    /// turns exist.
    pub fn start_before(&self, end: usize, turns: usize) -> usize {
        let end = end.min(self.messages.len());
        let mut remaining = turns.max(1) + usize::from(!self.is_boundary(end));
        for index in (0..end).rev() {
            if !self.starts[index] {
                continue;
            }
            remaining -= 1;
            if remaining == 0 {
                return self.boundary(index);
            }
        }
        0
    }

    /// Drop whole turns from the top of `containers` (container `start` onward)
    /// while their wire size exceeds `limit`, keeping the newest turn. A turn
    /// goes with the markers that lead it. A newest turn that alone is too big
    /// is kept whole. Returns the new start.
    pub fn fit(
        &self,
        start: usize,
        containers: &mut Vec<Vec<EncodedItem>>,
        wire: &Wire,
        limit: usize,
    ) -> usize {
        let sizes: Vec<usize> = containers
            .iter()
            .enumerate()
            .map(|(offset, items)| wire.bytes(start + offset, items))
            .collect();
        let mut total: usize = sizes.iter().sum();
        let mut first = 0;
        while total > limit {
            let from = start + first + 1;
            let end = start + containers.len();
            let next = (from..end)
                .find(|&index| self.is_start(index))
                .map(|index| self.boundary(index).max(from) - start);
            let Some(next) = next else {
                break;
            };
            total -= sizes[first..next].iter().sum::<usize>();
            first = next;
        }
        containers.drain(..first);
        start + first
    }
}

/// What a client that sends `turns` receives for a window: tool results older than
/// the newest containers cut to previews when it opted in, and tool images as short
/// references instead of base64.
pub struct Wire {
    previews: bool,
    total: usize,
}

impl Wire {
    /// `total` is the transcript's container count.
    pub fn new(previews: bool, total: usize) -> Self {
        Self { previews, total }
    }

    /// Bytes container `index` (absolute) puts on the wire.
    pub fn bytes(&self, index: usize, items: &[EncodedItem]) -> usize {
        let old = index + crate::replay_previews::FULL_RESULT_CONTAINERS < self.total;
        items
            .iter()
            .map(|item| self.item_bytes(item, self.previews && old))
            .sum::<usize>()
            + items.len().saturating_sub(1)
            + 2
    }

    fn item_bytes(&self, item: &EncodedItem, preview: bool) -> usize {
        let previewed;
        let item = if preview && matches!(item, EncodedItem::ToolCall { .. }) {
            previewed = crate::replay_previews::preview_item(item);
            &previewed
        } else {
            item
        };
        let (image_bytes, images) = tool_images(item);
        encoded_bytes(item).saturating_sub(image_bytes) + images * IMAGE_REFERENCE_BYTES
    }
}

fn tool_images(item: &EncodedItem) -> (usize, usize) {
    let EncodedItem::ToolCall { content, .. } = item else {
        return (0, 0);
    };
    content
        .iter()
        .fold((0, 0), |(bytes, count), entry| match entry {
            ToolCallContent::Content {
                content: ContentBlock::Image { data, .. },
            } if !data.is_empty() => (bytes + data.len(), count + 1),
            _ => (bytes, count),
        })
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

/// JSON size of `item`, counted without building the string.
pub fn encoded_bytes<T: serde::Serialize + ?Sized>(item: &T) -> usize {
    let mut counter = Counter(0);
    if let Err(error) = serde_json::to_writer(&mut counter, item) {
        tracing::warn!(error = %error, "could not measure an encoded window");
    }
    counter.0
}

#[cfg(test)]
#[path = "turn_window_tests.rs"]
mod tests;
