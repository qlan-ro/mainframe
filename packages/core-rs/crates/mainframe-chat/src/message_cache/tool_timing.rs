use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use mainframe_types::chat::MessageContentNode;
use mainframe_types::tool_call_timing::MAX_EPOCH_MS;

use super::*;

impl Default for MessageCache {
    fn default() -> Self {
        Self::with_clock(Arc::new(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis().min(u128::from(MAX_EPOCH_MS)) as u64)
                .unwrap_or_default()
        }))
    }
}

impl MessageCache {
    pub fn with_clock(now_epoch_ms: Arc<dyn Fn() -> u64 + Send + Sync>) -> Self {
        Self {
            cache: HashMap::new(),
            order: Vec::new(),
            pinned: HashSet::new(),
            tool_timings: HashMap::new(),
            now_epoch_ms,
        }
    }

    pub(crate) fn append_live(&mut self, chat_id: &str, session: &str, message: ChatMessage) {
        let now = (self.now_epoch_ms)().min(MAX_EPOCH_MS);
        let store = self.tool_timings.entry(chat_id.to_owned()).or_default();
        store.observe(session, &message.content, now);
        self.track_key(chat_id);
        let messages = self.cache.entry(chat_id.to_owned()).or_default();
        messages.push(message);
        self.tool_timings[chat_id].apply(messages);
        self.evict_if_needed();
    }

    pub(crate) fn append_nested_live(
        &mut self,
        chat_id: &str,
        session: &str,
        parent: &str,
        blocks: Vec<MessageContent>,
    ) -> bool {
        let Some(messages) = self.cache.get_mut(chat_id) else {
            return false;
        };
        let Some(index) = messages.iter().rposition(|m| {
            m.r#type == ChatMessageType::Assistant && m.content.iter().any(|b| {
                matches!(b, MessageContent::Node(MessageContentNode::ToolUse { id, .. }) if id == parent)
            })
        }) else { return false; };
        let now = (self.now_epoch_ms)().min(MAX_EPOCH_MS);
        let store = self.tool_timings.entry(chat_id.to_owned()).or_default();
        store.observe(session, &blocks, now);
        messages[index].content.extend(blocks);
        store.apply(messages);
        true
    }

    pub(crate) fn finish_tool_calls(&mut self, chat_id: &str, session: &str) -> bool {
        let Some(store) = self.tool_timings.get_mut(chat_id) else {
            return false;
        };
        let now = (self.now_epoch_ms)().min(MAX_EPOCH_MS);
        let changed = store.finish_session(session, now);
        if let Some(messages) = self.cache.get_mut(chat_id) {
            store.apply(messages);
        }
        changed
    }
}
