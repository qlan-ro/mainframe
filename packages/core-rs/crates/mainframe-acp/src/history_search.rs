use std::collections::VecDeque;

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::extensions::{
    HistoryMatch, HistorySearchResult, ItemMeta, MAINFRAME_META_NAMESPACE,
};
use mainframe_types::display::{DisplayMessage, DisplayMessageType};
use mainframe_types::message_markers::visible_prose_text;

use crate::{EncodedItem, encoder};

pub const MAX_MATCHES: usize = 2000;

pub fn search(messages: &[DisplayMessage], query: &str) -> HistorySearchResult {
    if query.is_empty() {
        return HistorySearchResult::default();
    }
    let needle = query.to_lowercase();
    let mut total = 0;
    let mut matches = VecDeque::new();
    for message in messages {
        if !matches!(
            message.r#type,
            DisplayMessageType::User | DisplayMessageType::Assistant
        ) {
            continue;
        }
        for item in encoder::encode_container(message, None) {
            let Some(text) = searchable_text(&item) else {
                continue;
            };
            let text = visible_prose_text(&text).to_lowercase();
            let mut occurrence = 0;
            for (start, _) in text.char_indices() {
                if !text[start..].starts_with(&needle) {
                    continue;
                }
                total += 1;
                matches.push_back(HistoryMatch {
                    container_id: message.id.clone(),
                    item_id: item.id().to_string(),
                    occurrence,
                });
                occurrence += 1;
                if matches.len() > MAX_MATCHES {
                    matches.pop_front();
                }
            }
        }
    }
    HistorySearchResult {
        total,
        matches: matches.into(),
        truncated: (total > MAX_MATCHES).then_some(true),
    }
}

fn searchable_text(item: &EncodedItem) -> Option<String> {
    let EncodedItem::Message { content, meta, .. } = item else {
        return None;
    };
    let meta: ItemMeta = meta
        .as_ref()
        .and_then(|m| m.get(MAINFRAME_META_NAMESPACE))
        .and_then(|m| serde_json::from_value(m.clone()).ok())
        .unwrap_or_default();
    if meta.parent_tool_call_id.is_some() || meta.kind.is_some() || meta.provider_switch.is_some() {
        return None;
    }
    Some(
        content
            .iter()
            .filter_map(|block| match block {
                ContentBlock::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect(),
    )
}
