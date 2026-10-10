//! Per-session diff engine: consecutive [`crate::encoder::EncodedItem`]
//! snapshots diff into chunk appends (tail-block text growth and appended
//! blocks) and `tool_call_update`-style patches (omit/null/value/append) —
//! never a full resend of an item's accumulated content after its first frame.
//! One [`SessionState`] per attached facade session; `throttle.rs` coalesces
//! its output before it reaches the wire.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use mainframe_types::acp::content::{ContentBlock, ContentChunk};
use mainframe_types::acp::update::{MessageUpsert, SessionUpdate};
use serde_json::Value;

use crate::encoder::{EncodedItem, ItemRole};
use crate::replay_previews::preview_item;

mod containers;
mod tool_patch;
pub(crate) mod updates;
use tool_patch::tool_call_patch;
use updates::{clear_update, create_patch, create_update, message_variant, upsert_variant};

/// Per-item last-known state, so a diff against a fresh [`SessionState`] (a
/// just-attached or just-resumed session) always creates every item, which is
/// what a `session/resume` replay relies on.
///
/// `containers` and `seeded` are the container-delta half of this state: a
/// per-ordinal list of item ids, kept in sync by [`containers::apply`] so an
/// incremental [`crate::encoder::delta::EncodedDelta`] can find exactly which old
/// ids an affected or removed ordinal owned without scanning every item. `diff`
/// does not maintain this index — it is the resume-replay path, always starting
/// from a fresh, unseeded state.
///
/// `previews` is the set of tool-call ids this connection holds as result
/// previews: every incoming revision of one of them is trimmed the same way
/// before it is compared or stored, so a live full re-encode of a settled
/// container never "restores" a result the client only has a preview of. Empty
/// for a connection that did not opt in.
#[derive(Default)]
pub struct SessionState {
    items: HashMap<String, EncodedItem>,
    containers: Vec<Vec<String>>,
    seeded: bool,
    items_compared: u64,
    previews: HashSet<String>,
}

impl SessionState {
    pub fn new() -> Self {
        Self::default()
    }

    /// The tool-call ids whose results this state keeps as previews — set
    /// once, from the resume that seeds the state, before any item lands.
    pub fn set_previews(&mut self, ids: HashSet<String>) {
        self.previews = ids;
    }

    /// `item` as this state stores it: trimmed when its id is previewed,
    /// borrowed as-is otherwise.
    fn previewed<'a>(&self, item: &'a EncodedItem) -> Cow<'a, EncodedItem> {
        if self.previews.contains(item.id()) {
            Cow::Owned(preview_item(item))
        } else {
            Cow::Borrowed(item)
        }
    }

    /// Cumulative count of items this state has compared against their previous
    /// value, across every `diff`/`apply` call — the deterministic gate an
    /// incremental `apply` must not grow past the affected containers' item
    /// count, no matter how much settled history sits outside them.
    pub fn items_compared(&self) -> u64 {
        self.items_compared
    }

    /// Diff a fresh encoder snapshot against the last one seen, returning the
    /// `session/update` payloads needed to converge a client from the old
    /// state to the new one. A message/thought item missing from the snapshot
    /// gets one content-clearing upsert and is forgotten — the
    /// partial-streaming overlay can vanish wholesale (an `api_error` retry
    /// or an interrupt aborts the in-flight block), and a client must not
    /// keep text the transcript never got. Tool calls are still left as-is:
    /// they are never overlay-created, and the flows that remove them
    /// (truncation, `/clear`) re-seed every attached session via resume.
    pub fn diff(&mut self, new_items: &[EncodedItem]) -> Vec<SessionUpdate> {
        let mut updates = self.clear_vanished(new_items);
        for item in new_items {
            self.items_compared += 1;
            let item = self.previewed(item);
            match self.items.get(item.id()) {
                None => updates.push(create_update(&item)),
                Some(prev) if *prev == *item => {}
                Some(prev) => updates.extend(revise_update(prev, &item)),
            }
            self.items.insert(item.id().to_string(), item.into_owned());
        }
        self.seeded = true;
        updates
    }

    fn clear_vanished(&mut self, new_items: &[EncodedItem]) -> Vec<SessionUpdate> {
        let new_ids: std::collections::HashSet<&str> =
            new_items.iter().map(EncodedItem::id).collect();
        let mut vanished: Vec<String> = self
            .items
            .iter()
            .filter(|(id, item)| {
                !new_ids.contains(id.as_str()) && !matches!(item, EncodedItem::ToolCall { .. })
            })
            .map(|(id, _)| id.clone())
            .collect();
        // HashMap order is arbitrary; sort so multi-item clears are stable.
        vanished.sort();
        vanished
            .into_iter()
            .filter_map(|id| self.items.remove(&id))
            .map(|item| clear_update(&item))
            .collect()
    }
}

/// The invariant this function exists to guarantee: once an item has had its
/// first frame (`create_update`), no later frame for it carries its full
/// accumulated content again — a pure suffix growth is a chunk (the delta
/// only), and anything else is an explicit revision, never a repeat of what the
/// client already has.
fn revise_update(prev: &EncodedItem, new: &EncodedItem) -> Vec<SessionUpdate> {
    match (prev, new) {
        (
            EncodedItem::Message {
                id,
                role,
                content: prev_content,
                meta: prev_meta,
            },
            EncodedItem::Message {
                content: new_content,
                meta: new_meta,
                ..
            },
        ) => content_revision(
            id,
            *role,
            false,
            prev_content,
            new_content,
            prev_meta,
            new_meta,
        ),
        (
            EncodedItem::Thought {
                id,
                content: prev_content,
                meta: prev_meta,
            },
            EncodedItem::Thought {
                content: new_content,
                meta: new_meta,
                ..
            },
        ) => content_revision(
            id,
            ItemRole::Agent,
            true,
            prev_content,
            new_content,
            prev_meta,
            new_meta,
        ),
        (EncodedItem::ToolCall { .. }, EncodedItem::ToolCall { .. }) => {
            vec![tool_call_patch(prev, new)]
        }
        // An item's kind never changes post-creation in this pipeline; a
        // mismatch here would be an encoder bug, not a wire case to model.
        _ => Vec::new(),
    }
}

#[allow(clippy::too_many_arguments)]
fn content_revision(
    id: &str,
    role: ItemRole,
    is_thought: bool,
    prev: &[ContentBlock],
    new: &[ContentBlock],
    prev_meta: &Option<Value>,
    new_meta: &Option<Value>,
) -> Vec<SessionUpdate> {
    if prev == new {
        // Meta-only change (turn end attaching duration, a retry marker
        // landing, …): patch the meta, leave `content` omitted = unchanged.
        // `Some(new_meta.clone())` and not `create_patch` — a cleared meta
        // must wire as an explicit `null`, not vanish from the patch.
        return vec![upsert_variant(role, is_thought)(MessageUpsert {
            message_id: id.to_string(),
            content: None,
            meta: Some(new_meta.clone()),
        })];
    }
    if let Some(deltas) = chunk_extension(prev, new) {
        let variant = message_variant(role, is_thought);
        let meta_changed = new_meta != prev_meta;
        return deltas
            .into_iter()
            .enumerate()
            .map(|(i, block)| {
                variant(ContentChunk {
                    message_id: id.to_string(),
                    // A changed item meta rides the first chunk only — the
                    // client patches item meta per chunk, so repeating it
                    // would be redundant wire bytes.
                    meta: new_meta.clone().filter(|_| meta_changed && i == 0),
                    content: block,
                })
            })
            .collect();
    }
    // Not a pure extension (shrank, or diverged mid-list — e.g. a retry
    // replacing content wholesale): a full revision, valid exactly once per
    // divergence, never a repeat of a value already sent.
    vec![upsert_variant(role, is_thought)(MessageUpsert {
        message_id: id.to_string(),
        content: create_patch(Some(new.to_vec())),
        meta: if new_meta == prev_meta {
            None
        } else {
            Some(new_meta.clone())
        },
    })]
}

/// Is `new` a pure extension of `prev`? Every prev block except the last must
/// be unchanged; the last may have grown as a text suffix (same `_meta`); any
/// blocks past `prev.len()` are appends. Returns the chunk deltas to emit —
/// the grown tail's text delta followed by each appended block whole — or
/// `None` when the revision is not expressible as appends. Lossless because
/// the encoder never emits adjacent text blocks, so the client's
/// trailing-text coalescing reassembles exactly this list.
fn chunk_extension(prev: &[ContentBlock], new: &[ContentBlock]) -> Option<Vec<ContentBlock>> {
    if new.len() < prev.len() {
        return None;
    }
    let mut deltas = Vec::new();
    if let Some((prev_last, prev_head)) = prev.split_last() {
        if &new[..prev_head.len()] != prev_head {
            return None;
        }
        let new_at_last = &new[prev_head.len()];
        if new_at_last != prev_last {
            match (prev_last, new_at_last) {
                (
                    ContentBlock::Text {
                        text: prev_text,
                        meta: pm,
                    },
                    ContentBlock::Text {
                        text: new_text,
                        meta: nm,
                    },
                ) if pm == nm
                    && new_text.len() > prev_text.len()
                    && new_text.starts_with(prev_text.as_str()) =>
                {
                    deltas.push(ContentBlock::Text {
                        text: new_text[prev_text.len()..].to_string(),
                        meta: None,
                    });
                }
                _ => return None,
            }
        }
    }
    deltas.extend(new[prev.len()..].iter().cloned());
    if deltas.is_empty() {
        None
    } else {
        Some(deltas)
    }
}

#[cfg(test)]
mod preview_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod vanish_tests;
