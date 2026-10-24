use std::collections::{HashMap, HashSet};

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::time::now_iso8601;

const MAX_CHATS: usize = 50;

/// Registry-pinned histories stay whole; unpinned histories are bounded by `MAX_CHATS`.
pub struct MessageCache {
    cache: HashMap<String, Vec<ChatMessage>>,
    pub(super) generations: HashMap<String, u64>,
    pub(super) next_generation: u64,
    order: Vec<String>,
    pinned: HashSet<String>,
    tool_timings: HashMap<String, crate::tool_call_timing::ToolTimingStore>,
    /// Per-chat incremental-display-projection state: a display projector plus
    /// its mutation journal. See `projection.rs`.
    projections: HashMap<String, projection::ProjectionSlot>,
    now_epoch_ms: std::sync::Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl MessageCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, chat_id: &str) -> Option<&Vec<ChatMessage>> {
        self.cache.get(chat_id)
    }

    /// Drop `chat_id`'s cache entry, keeping any pin (`deps_recovery.rs`'s
    /// recovery clear: the chat is still in the registry, so a bare `delete`
    /// without `unpin` would let `evict_if_needed` treat it as evictable).
    pub fn delete(&mut self, chat_id: &str) {
        self.tool_timings.remove(chat_id);
        self.drop_projection(chat_id);
        self.generations.remove(chat_id);
        if self.cache.remove(chat_id).is_some() {
            self.order.retain(|k| k != chat_id);
        }
    }

    /// Pin `chat_id`'s entry against `evict_if_needed`, called right after a
    /// registry cell is inserted (`create_chat`, `do_load_chat`, the fork
    /// insert).
    pub fn pin(&mut self, chat_id: &str) {
        self.pinned.insert(chat_id.to_string());
    }

    /// Unpin `chat_id` without touching its cache entry (`end_chat`: the
    /// registry cell goes, but the cache stays, now evictable).
    pub(crate) fn unpin(&mut self, chat_id: &str) {
        self.pinned.remove(chat_id);
    }

    /// Test-only pin query: lets a test observe that `release` actually dropped
    /// the pin, without depending on the eviction-order side effect
    /// `release_unpins`'s existing assertion uses.
    #[cfg(test)]
    pub(crate) fn is_pinned(&self, chat_id: &str) -> bool {
        self.pinned.contains(chat_id)
    }

    /// `delete` plus `unpin` — the registry-cell-removal paths (offload,
    /// archive, discard) that tear a chat down as one unit.
    pub fn release(&mut self, chat_id: &str) {
        self.delete(chat_id);
        self.unpin(chat_id);
    }

    /// Appends `message`. No per-chat cap: a registry-pinned chat keeps its
    /// whole transcript, and `evict_if_needed` is the only bound, applied
    /// across chats rather than within one.
    pub fn append(&mut self, chat_id: &str, mut message: ChatMessage) {
        self.tool_timings
            .entry(chat_id.to_owned())
            .or_default()
            .merge_history(std::slice::from_mut(&mut message));
        self.track_key(chat_id);
        let messages = self.cache.entry(chat_id.to_string()).or_default();
        messages.push(message);
        let changed = self.tool_timings[chat_id].apply(messages);
        self.record_change(chat_id, mainframe_display::RawChange::Appended);
        for (id, timing) in changed {
            self.record_change(chat_id, mainframe_display::RawChange::Timing(id, timing));
        }
        self.evict_if_needed();
    }

    /// Drop the oldest *unpinned* chat while over `MAX_CHATS`. A chat with a
    /// live registry cell is pinned and skipped, so the registry's own bound
    /// (idle offload, end, archive, discard) is the real cap once every chat is
    /// pinned.
    fn evict_if_needed(&mut self) {
        while self.cache.len() > MAX_CHATS {
            let Some(idx) = self.order.iter().position(|k| !self.pinned.contains(k)) else {
                break;
            };
            let oldest = self.order.remove(idx);
            self.cache.remove(&oldest);
            self.tool_timings.remove(&oldest);
            self.drop_projection(&oldest);
        }
    }

    /// Remove a message by ID. Returns true if found and removed.
    pub fn remove_by_id(&mut self, chat_id: &str, message_id: &str) -> bool {
        let Some(msgs) = self.cache.get_mut(chat_id) else {
            return false;
        };
        let Some(idx) = msgs.iter().position(|m| m.id == message_id) else {
            return false;
        };
        msgs.remove(idx);
        self.record_change(chat_id, mainframe_display::RawChange::Structural(idx));
        true
    }

    /// Move a message to the end of the chat's list. Returns true if found and moved.
    pub fn move_to_end(&mut self, chat_id: &str, message_id: &str) -> bool {
        let Some(msgs) = self.cache.get_mut(chat_id) else {
            return false;
        };
        let Some(idx) = msgs.iter().position(|m| m.id == message_id) else {
            return false;
        };
        let msg = msgs.remove(idx);
        msgs.push(msg);
        self.record_change(chat_id, mainframe_display::RawChange::Structural(idx));
        true
    }

    /// Strip `queued`/`uuid` metadata from the message with `id`, then move it
    /// to the end (mirrors `delete m.metadata.queued; messages.moveToEnd(id)`).
    /// Replaces the old clone-mutate-`set` round trip
    /// (`SessionSinkImpl::mutate_messages`): it records a `Structural(from)`
    /// journal entry instead of dropping the projection slot wholesale, and it
    /// never clones the chat's history to do it.
    pub fn strip_queued_and_move_to_end(&mut self, chat_id: &str, id: &str) -> bool {
        let Some(msgs) = self.cache.get_mut(chat_id) else {
            return false;
        };
        let Some(pos) = msgs.iter().position(|m| m.id == id) else {
            return false;
        };
        if let Some(md) = msgs[pos].metadata.as_mut() {
            md.remove("queued");
            md.remove("uuid");
        }
        let m = msgs.remove(pos);
        msgs.push(m);
        self.record_change(chat_id, mainframe_display::RawChange::Structural(pos));
        true
    }

    /// Strip `queued`/`uuid` metadata from every queued message in `chat_id`
    /// (session exit: the CLI owns every queued prompt, none can be replayed
    /// after it dies). Returns whether any message was queued. Records one
    /// `Structural` entry at the earliest touched index, same as a single
    /// `strip_queued_and_move_to_end` call would.
    pub fn strip_all_queued(&mut self, chat_id: &str) -> bool {
        let Some(msgs) = self.cache.get_mut(chat_id) else {
            return false;
        };
        let mut first_touched: Option<usize> = None;
        for (idx, m) in msgs.iter_mut().enumerate() {
            if !is_queued(m) {
                continue;
            }
            if let Some(md) = m.metadata.as_mut() {
                md.remove("queued");
                md.remove("uuid");
            }
            first_touched.get_or_insert(idx);
        }
        let Some(from) = first_touched else {
            return false;
        };
        self.record_change(chat_id, mainframe_display::RawChange::Structural(from));
        true
    }

    /// Run `edit` over every message of `chat_id` in place; `edit` reports
    /// whether it changed that message. Records one `Structural` entry at the
    /// earliest changed index (the same journal shape `strip_all_queued` uses
    /// for its in-place metadata edits), so the display projector re-folds from
    /// there instead of dropping its slot. Returns whether any message changed.
    pub fn update_in_place(
        &mut self,
        chat_id: &str,
        mut edit: impl FnMut(&mut ChatMessage) -> bool,
    ) -> bool {
        let Some(msgs) = self.cache.get_mut(chat_id) else {
            return false;
        };
        let mut first_touched: Option<usize> = None;
        for (idx, m) in msgs.iter_mut().enumerate() {
            if edit(m) {
                first_touched.get_or_insert(idx);
            }
        }
        let Some(from) = first_touched else {
            return false;
        };
        self.record_change(chat_id, mainframe_display::RawChange::Structural(from));
        true
    }

    pub fn create_transient_message(
        &self,
        chat_id: &str,
        r#type: ChatMessageType,
        content: Vec<MessageContent>,
        metadata: Option<HashMap<String, serde_json::Value>>,
    ) -> ChatMessage {
        self.create_transient_message_with_vendor_id(chat_id, r#type, content, metadata, None)
    }

    /// `create_transient_message`, with an adapter-supplied id (the transcript
    /// uuid / thread-item id) in place of a minted nanoid. `None` falls back to
    /// the nanoid path unchanged, so this is additive: every existing caller of
    /// `create_transient_message` keeps its current behavior verbatim.
    pub fn create_transient_message_with_vendor_id(
        &self,
        chat_id: &str,
        r#type: ChatMessageType,
        content: Vec<MessageContent>,
        metadata: Option<HashMap<String, serde_json::Value>>,
        vendor_id: Option<String>,
    ) -> ChatMessage {
        ChatMessage {
            id: vendor_id.unwrap_or_else(|| nanoid::nanoid!()),
            chat_id: chat_id.to_string(),
            r#type,
            content,
            timestamp: now_iso8601(),
            metadata,
        }
    }

    /// Track a key's insertion position without disturbing an existing key's slot
    /// (JS `Map.set` on an existing key keeps its original order).
    fn track_key(&mut self, chat_id: &str) {
        if !self.cache.contains_key(chat_id) {
            self.order.push(chat_id.to_string());
        }
    }
}

/// `metadata.queued === true` (`strip_all_queued`'s per-message test).
fn is_queued(m: &ChatMessage) -> bool {
    m.metadata
        .as_ref()
        .and_then(|md| md.get("queued"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

#[cfg(test)]
#[path = "message_cache_tests.rs"]
mod tests;

#[cfg(test)]
pub(crate) mod timing_tests;

mod tool_timing;

#[cfg(test)]
mod history_timing_tests;

mod history;

mod projection;
