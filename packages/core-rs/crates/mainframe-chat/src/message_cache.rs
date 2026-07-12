//! Ported from `packages/core/src/chat/message-cache.ts`.

use std::collections::HashMap;

use mainframe_runtime::time::now_iso8601;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};

const MAX_MESSAGES_PER_CHAT: usize = 2000;
const MAX_CHATS: usize = 50;

/// Bounded in-memory message store keyed by chat id.
///
/// CONCURRENCY.tsv (`message-cache.ts cache`): PER_ENTITY — folds into
/// `ChatState.messages: Vec<ChatMessage>` once chat_manager lands. The cross-chat
/// LRU evict (`MAX_CHATS`) becomes a registry op there; here it is preserved as
/// the standalone-class behavior. `order` mirrors JS `Map` insertion order so
/// `evictIfNeeded` drops the oldest chat, matching `cache.keys().next()`.
#[derive(Default)]
pub struct MessageCache {
    cache: HashMap<String, Vec<ChatMessage>>,
    order: Vec<String>,
}

impl MessageCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, chat_id: &str) -> Option<&Vec<ChatMessage>> {
        self.cache.get(chat_id)
    }

    pub fn set(&mut self, chat_id: &str, messages: Vec<ChatMessage>) {
        let trimmed = tail(messages, MAX_MESSAGES_PER_CHAT);
        self.track_key(chat_id);
        self.cache.insert(chat_id.to_string(), trimmed);
        self.evict_if_needed();
    }

    pub fn delete(&mut self, chat_id: &str) {
        if self.cache.remove(chat_id).is_some() {
            self.order.retain(|k| k != chat_id);
        }
    }

    pub fn append(&mut self, chat_id: &str, message: ChatMessage) {
        self.track_key(chat_id);
        let messages = self.cache.entry(chat_id.to_string()).or_default();
        messages.push(message);
        if messages.len() > MAX_MESSAGES_PER_CHAT {
            let overflow = messages.len() - MAX_MESSAGES_PER_CHAT;
            messages.drain(0..overflow);
        }
        self.evict_if_needed();
    }

    fn evict_if_needed(&mut self) {
        while self.cache.len() > MAX_CHATS {
            if self.order.is_empty() {
                break;
            }
            let oldest = self.order.remove(0);
            self.cache.remove(&oldest);
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
        ChatMessage {
            id: nanoid::nanoid!(),
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

/// `messages.slice(-n)` — keep the last `n` elements.
fn tail(mut messages: Vec<ChatMessage>, n: usize) -> Vec<ChatMessage> {
    if messages.len() > n {
        let overflow = messages.len() - n;
        messages.drain(0..overflow);
    }
    messages
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
}

// PORT STATUS: src/chat/message-cache.ts (76 lines)
// confidence: high
// todos: 0
// notes: `Map<string, ChatMessage[]>` → `HashMap` + an `order: Vec<String>` that
// notes: mirrors JS `Map` insertion order so `evictIfNeeded` drops the oldest chat
// notes: (`cache.keys().next()`). `slice(-N)`/`splice` → `tail`/`drain`. nanoid +
// notes: now_iso8601 for createTransientMessage. move-to-end test ported verbatim.
