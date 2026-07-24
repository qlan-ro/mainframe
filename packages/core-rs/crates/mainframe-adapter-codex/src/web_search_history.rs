//! `webSearch` history-reload conversion — the `convert_thread_items` counterpart
//! to the live path's `render_web_search` (`web_search_render.rs`). Split into its
//! own module so `history.rs` only gains a thin dispatch arm.

use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, ChatMessageType};
use serde_json::json;

use crate::history::{make_message, tool_result_block, tool_use_block};
use crate::item_types::WebSearchItem;

/// Mirrors `render_web_search`: an already-complete `WebSearch` tool_use/tool_result
/// pair, since Codex's `webSearch` item carries only the query and no separate
/// result payload ever follows it.
pub(crate) fn web_search_messages(w: &WebSearchItem, chat_id: &str) -> Vec<ChatMessage> {
    let mut input = HashMap::new();
    input.insert("query".to_string(), json!(w.query));
    vec![
        make_message(
            &w.id,
            chat_id,
            ChatMessageType::Assistant,
            vec![tool_use_block(&w.id, "WebSearch", input)],
        ),
        make_message(
            &format!("{}:result", w.id),
            chat_id,
            ChatMessageType::ToolResult,
            vec![tool_result_block(&w.id, "", false, None)],
        ),
    ]
}
