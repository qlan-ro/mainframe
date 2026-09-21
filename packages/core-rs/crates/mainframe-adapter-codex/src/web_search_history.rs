//! `webSearch` history-reload conversion — the `convert_thread_items` counterpart
//! to the live path's `render_web_search` (`web_search_render.rs`). Split into its
//! own module so `history.rs` only gains a thin dispatch arm.

use mainframe_types::chat::{ChatMessage, ChatMessageType};

use crate::history::{make_message, tool_result_block, tool_use_block};
use crate::item_types::WebSearchItem;

/// Mirrors `render_web_search` via the same `tool_use_name_and_input`, so live
/// and reload can't drift on an `openPage` item's name; `webSearch.results` is
/// deliberately not read, so the tool_result content is always `""`.
pub(crate) fn web_search_messages(w: &WebSearchItem, chat_id: &str) -> Vec<ChatMessage> {
    let (name, input) = w.tool_use_name_and_input();
    vec![
        make_message(
            &w.id,
            chat_id,
            ChatMessageType::Assistant,
            vec![tool_use_block(&w.id, name, input)],
        ),
        make_message(
            &format!("{}:result", w.id),
            chat_id,
            ChatMessageType::ToolResult,
            vec![tool_result_block(&w.id, "", false, None)],
        ),
    ]
}
