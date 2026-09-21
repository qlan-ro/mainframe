//! Renders a completed `webSearch` item. Split out of `thread_item_render.rs` to
//! keep that module under the 300-line ceiling (mirrors `image_generation_render.rs`).

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;

use crate::history::{tool_result_block, tool_use_block, vendor_metadata};
use crate::item_types::WebSearchItem;

/// An `openPage` action renders as `WebFetch{url}`; every other action (search,
/// none, or an unrecognized tag) keeps today's `WebSearch{query}` pair. Either
/// way it's emitted already-complete — `webSearch.results` is deliberately not
/// read (todo #356 plan, "Established facts"), so the tool_result content is
/// always `""`.
pub(crate) fn render_web_search(w: &WebSearchItem, sink: &Arc<dyn SessionSink>) {
    let (name, input) = w.tool_use_name_and_input();
    sink.on_message(
        vec![tool_use_block(&w.id, name, input)],
        vendor_metadata(&w.id),
    );
    sink.on_tool_result(
        vec![tool_result_block(&w.id, "", false, None)],
        Some(format!("{}:result", w.id)),
    );
}
