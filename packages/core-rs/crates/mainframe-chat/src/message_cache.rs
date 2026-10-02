//! Ported from `packages/core/src/chat/message-cache.ts`.

use std::collections::{HashMap, HashSet};

use mainframe_runtime::time::now_iso8601;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};

const MAX_CHATS: usize = 50;

/// In-memory message store keyed by chat id, with no per-chat message cap
/// (todo #350 R1, D1/D2): a chat the lifecycle registry still holds is pinned
/// whole, so retention is never visible on the wire (no resync, no dropped
/// history). `MAX_CHATS` bounds only unpinned entries — cold reads for a chat
/// with no registry cell (`get_messages`); see `evict_if_needed`.
///
/// CONCURRENCY.tsv (`message-cache.ts cache`): PER_ENTITY — folds into
/// `ChatState.messages: Vec<ChatMessage>` once chat_manager lands. `order`
/// mirrors JS `Map` insertion order so `evict_if_needed` drops the oldest
/// unpinned chat, matching `cache.keys().next()`.
pub struct MessageCache {
    cache: HashMap<String, Vec<ChatMessage>>,
    order: Vec<String>,
    pinned: HashSet<String>,
    tool_timings: HashMap<String, crate::tool_call_timing::ToolTimingStore>,
    now_epoch_ms: std::sync::Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl MessageCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, chat_id: &str) -> Option<&Vec<ChatMessage>> {
        self.cache.get(chat_id)
    }

    pub fn set(&mut self, chat_id: &str, mut messages: Vec<ChatMessage>) {
        self.tool_timings
            .entry(chat_id.to_owned())
            .or_default()
            .merge_history(&mut messages);
        self.track_key(chat_id);
        self.cache.insert(chat_id.to_string(), messages);
        self.evict_if_needed();
    }

    /// Drop `chat_id`'s cache entry, keeping any pin (`deps_recovery.rs`'s
    /// recovery clear: the chat is still in the registry, so a bare `delete`
    /// without `unpin` would let `evict_if_needed` treat it as evictable).
    pub fn delete(&mut self, chat_id: &str) {
        self.tool_timings.remove(chat_id);
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
    pub fn unpin(&mut self, chat_id: &str) {
        self.pinned.remove(chat_id);
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
        self.tool_timings[chat_id].apply(messages);
        self.evict_if_needed();
    }

    /// Drop the oldest *unpinned* chat while over `MAX_CHATS`. A chat with a
    /// live registry cell is pinned and skipped, so the registry's own bound
    /// (idle offload, end, archive, discard) is the real cap once every chat
    /// is pinned (D1).
    fn evict_if_needed(&mut self) {
        while self.cache.len() > MAX_CHATS {
            let Some(idx) = self.order.iter().position(|k| !self.pinned.contains(k)) else {
                break;
            };
            let oldest = self.order.remove(idx);
            self.cache.remove(&oldest);
            self.tool_timings.remove(&oldest);
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
    /// uuid / thread-item id) in place of a minted nanoid — todo #350 group B,
    /// stable-ids task 5. `None` falls back to the nanoid path unchanged, so
    /// this is additive: every existing caller of `create_transient_message`
    /// keeps its current behavior verbatim.
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

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::content::LeafContent;

    fn msg(id: &str) -> ChatMessage {
        ChatMessage {
            id: id.to_string(),
            chat_id: "c1".to_string(),
            r#type: ChatMessageType::User,
            content: vec![MessageContent::Leaf(LeafContent::Text {
                text: id.to_string(),
                parent_tool_use_id: None,
            })],
            timestamp: now_iso8601(),
            metadata: None,
        }
    }

    fn ids(cache: &MessageCache, chat_id: &str) -> Vec<String> {
        cache
            .get(chat_id)
            .unwrap()
            .iter()
            .map(|m| m.id.clone())
            .collect()
    }

    // Ports message-cache-move-to-end.test.ts assertion-for-assertion.
    #[test]
    fn moves_a_message_to_the_end_and_preserves_the_others_in_order() {
        let mut cache = MessageCache::new();
        cache.append("c1", msg("a"));
        cache.append("c1", msg("b"));
        cache.append("c1", msg("c"));
        assert!(cache.move_to_end("c1", "a"));
        assert_eq!(ids(&cache, "c1"), vec!["b", "c", "a"]);
    }

    #[test]
    fn returns_false_for_an_unknown_chat_or_message() {
        let mut cache = MessageCache::new();
        cache.append("c1", msg("a"));
        assert!(!cache.move_to_end("c1", "missing"));
        assert!(!cache.move_to_end("nope", "a"));
    }

    #[test]
    fn keeps_order_when_the_message_is_already_last() {
        let mut cache = MessageCache::new();
        cache.append("c1", msg("a"));
        cache.append("c1", msg("b"));
        assert!(cache.move_to_end("c1", "b"));
        assert_eq!(ids(&cache, "c1"), vec!["a", "b"]);
    }

    #[test]
    fn append_never_drops_from_the_front() {
        let mut cache = MessageCache::new();
        for n in 0..2_500 {
            cache.append("c1", msg(&n.to_string()));
        }
        let expected: Vec<String> = (0..2_500).map(|n| n.to_string()).collect();
        assert_eq!(ids(&cache, "c1"), expected);
    }

    #[test]
    fn set_keeps_every_message() {
        let mut cache = MessageCache::new();
        let messages: Vec<ChatMessage> = (0..2_500).map(|n| msg(&n.to_string())).collect();
        cache.set("c1", messages);
        assert_eq!(cache.get("c1").unwrap().len(), 2_500);
    }

    #[test]
    fn eviction_skips_pinned_chats() {
        let mut cache = MessageCache::new();
        cache.pin("a");
        cache.set("a", vec![msg("a-1")]);
        for n in 0..50 {
            cache.set(&format!("chat-{n}"), vec![msg("m")]);
        }
        assert!(
            cache.get("a").is_some(),
            "the pinned chat survives eviction"
        );
        assert!(
            cache.get("chat-0").is_none(),
            "the oldest unpinned chat is evicted instead"
        );
    }

    #[test]
    fn all_pinned_never_evicts() {
        let mut cache = MessageCache::new();
        for n in 0..51 {
            let id = format!("chat-{n}");
            cache.pin(&id);
            cache.set(&id, vec![msg("m")]);
        }
        for n in 0..51 {
            assert!(
                cache.get(&format!("chat-{n}")).is_some(),
                "chat-{n} must survive: every entry is pinned"
            );
        }
    }

    #[test]
    fn release_unpins() {
        let mut cache = MessageCache::new();
        cache.pin("a");
        cache.set("a", vec![msg("a-1")]);
        cache.release("a");
        assert!(cache.get("a").is_none(), "release deletes the entry too");

        // Re-adding the same id proves `release` actually cleared the pin:
        // an un-pinned "a" is now the oldest key and is the first evicted.
        cache.set("a", vec![msg("a-2")]);
        for n in 0..50 {
            cache.set(&format!("chat-{n}"), vec![msg("m")]);
        }
        assert!(
            cache.get("a").is_none(),
            "a re-added, un-pinned chat is evictable again"
        );
    }
}

// PORT STATUS: src/chat/message-cache.ts (76 lines)
// confidence: high
// todos: 0
// notes: `Map<string, ChatMessage[]>` → `HashMap` + an `order: Vec<String>` that
// notes: mirrors JS `Map` insertion order so `evict_if_needed` drops the oldest
// notes: unpinned chat (`cache.keys().next()`, skipping pinned keys — todo #350
// notes: R1, D1). No per-chat message cap: a chat with a live registry cell is
// notes: pinned whole. nanoid + now_iso8601 for createTransientMessage.
// notes: move-to-end test ported verbatim.

#[cfg(test)]
pub(crate) mod timing_tests;

mod tool_timing;
