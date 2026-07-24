//! Renders a completed `webSearch` item. Split out of `thread_item_render.rs` to
//! keep that module under the 300-line ceiling (mirrors `image_generation_render.rs`).

use std::collections::HashMap;
use std::sync::Arc;

use mainframe_adapter_api::SessionSink;

use crate::history::{tool_result_block, tool_use_block};
use crate::item_types::WebSearchItem;

/// Codex's `webSearch` item carries only the query — no result payload ever
/// follows it — so it's emitted as an already-complete `WebSearch` tool_use/
/// tool_result pair (name matches the UI's `register-cards.ts` entry).
pub(crate) fn render_web_search(w: &WebSearchItem, sink: &Arc<dyn SessionSink>) {
    let mut input = HashMap::new();
    input.insert("query".to_string(), serde_json::json!(w.query));
    sink.on_message(vec![tool_use_block(&w.id, "WebSearch", input)], None);
    sink.on_tool_result(vec![tool_result_block(&w.id, "", false, None)]);
}
