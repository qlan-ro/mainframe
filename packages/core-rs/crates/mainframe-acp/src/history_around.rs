//! `_mainframe.dev/history_around`: a window of items centred on one item.
//!
//! Works on the borrowed display list. Only the containers the window touches
//! are encoded, so the cost follows the counts, not the transcript's length.

use std::collections::VecDeque;

use mainframe_types::acp::extensions::{HistoryAroundParams, HistoryAroundResult};
use mainframe_types::display::DisplayMessage;

use crate::history_page::{PageOptions, PreparedPage, render};
use crate::{EncodedItem, ResumePort, history_window, item_window, resume::with_messages};

pub const DEFAULT_ITEMS: usize = 20;
pub const MAX_ITEMS: usize = 200;

fn count(value: Option<i64>) -> usize {
    value.map_or(DEFAULT_ITEMS, |v| v.clamp(0, MAX_ITEMS as i64) as usize)
}

fn stale() -> HistoryAroundResult {
    HistoryAroundResult {
        stale: Some(true),
        ..HistoryAroundResult::default()
    }
}

/// The item `id` names inside its container: the item itself, or the first
/// item when `id` is the container's own id.
fn locate(message: &DisplayMessage, items: &[EncodedItem], id: &str) -> Option<usize> {
    items
        .iter()
        .position(|item| history_window::matches_item(item, id))
        .or_else(|| (message.id == id && !items.is_empty()).then_some(0))
}

/// Serve the window from the chat's list in place; `None` if the port could
/// not read it.
pub async fn around_chat(
    port: &dyn ResumePort,
    params: &HistoryAroundParams,
    options: PageOptions,
) -> Option<HistoryAroundResult> {
    with_messages(port, &params.session_id, |messages| {
        prepare(messages, params, options)
    })
    .await
}

/// The encoded containers `lo..=hi` around the target, grown outwards only
/// while the counts need more items.
struct Block {
    containers: VecDeque<Vec<EncodedItem>>,
    lo: usize,
    hi: usize,
    /// Flat position of the target within `containers`.
    target: usize,
}

fn grow(
    messages: &[DisplayMessage],
    index: usize,
    home: Vec<EncodedItem>,
    offset: usize,
    (want_before, want_after): (usize, usize),
) -> Block {
    let encode = |at: usize| history_window::encode_range(messages, None, at, at + 1).remove(0);
    let mut after = home.len() - offset - 1;
    let mut containers = VecDeque::from([home]);
    let (mut lo, mut hi) = (index, index);
    let mut before = offset;
    while before < want_before && lo > 0 {
        lo -= 1;
        let items = encode(lo);
        before += items.len();
        containers.push_front(items);
    }
    while after < want_after && hi + 1 < messages.len() {
        hi += 1;
        let items = encode(hi);
        after += items.len();
        containers.push_back(items);
    }
    Block {
        containers,
        lo,
        hi,
        target: before,
    }
}

struct Cut {
    containers: Vec<Vec<EncodedItem>>,
    context: Vec<String>,
    first: Option<String>,
    last: Option<String>,
    /// Containers dropped before the first kept one.
    leading: usize,
}

/// Keep flat item positions `start..end`; the first kept container also
/// carries the ancestors its items need.
fn cut(block: VecDeque<Vec<EncodedItem>>, start: usize, end: usize) -> Cut {
    let mut out = Cut {
        containers: Vec::with_capacity(block.len()),
        context: Vec::new(),
        first: None,
        last: None,
        leading: 0,
    };
    let mut position = 0;
    for items in block {
        let from = start.saturating_sub(position).min(items.len());
        let to = end.saturating_sub(position).min(items.len());
        position += items.len();
        if from >= to {
            // Later empties stay, so a container's index is its position
            // from the first kept one (the preview cutoff counts on it).
            if out.first.is_some() {
                out.containers.push(Vec::new());
            } else {
                out.leading += 1;
            }
            continue;
        }
        let opening = out.first.is_none();
        out.first.get_or_insert_with(|| items[from].id().to_owned());
        out.last = Some(items[to - 1].id().to_owned());
        if opening {
            let kept = item_window::with_ancestors(&items, from, to);
            let context = kept.len() - (to - from);
            out.context = kept[..context].iter().map(|i| i.id().to_owned()).collect();
            out.containers.push(kept);
        } else {
            out.containers.push(items[from..to].to_vec());
        }
    }
    out
}

pub fn prepare(
    messages: &[DisplayMessage],
    params: &HistoryAroundParams,
    options: PageOptions,
) -> HistoryAroundResult {
    let Some(index) = history_window::find_item(messages, &params.item_id) else {
        return stale();
    };
    let home = history_window::encode_range(messages, None, index, index + 1).remove(0);
    let Some(offset) = locate(&messages[index], &home, &params.item_id) else {
        if home.is_empty() && messages[index].id == params.item_id {
            // A queued container exists but has no items yet: valid, empty.
            return HistoryAroundResult {
                has_before: index > 0,
                has_after: index + 1 < messages.len(),
                ..HistoryAroundResult::default()
            };
        }
        return stale();
    };
    let wanted = (count(params.before), count(params.after));
    let block = grow(messages, index, home, offset, wanted);

    let total: usize = block.containers.iter().map(Vec::len).sum();
    let start = block.target - wanted.0.min(block.target);
    let end = (block.target + 1 + wanted.1).min(total);
    let cut = cut(block.containers, start, end);
    let leading = cut.leading;
    let (containers, context_ids, first_id, last_id) =
        (cut.containers, cut.context, cut.first, cut.last);
    let target_id = containers
        .iter()
        .flatten()
        .nth(context_ids.len() + (block.target - start))
        .map(|item| item.id().to_owned());
    let mut page = PreparedPage {
        result: Default::default(),
        containers,
        start: block.lo + leading,
        len: messages.len(),
        previews: Default::default(),
    };
    render(messages.len(), &params.session_id, options, None, &mut page);
    HistoryAroundResult {
        updates: page.result.updates,
        batches: page.result.batches,
        has_before: block.lo > 0 || start > 0,
        has_after: block.hi + 1 < messages.len() || end < total,
        first_item_id: first_id,
        last_item_id: last_id,
        target_item_id: target_id,
        context_item_ids: (!context_ids.is_empty()).then_some(context_ids),
        stale: None,
    }
}
