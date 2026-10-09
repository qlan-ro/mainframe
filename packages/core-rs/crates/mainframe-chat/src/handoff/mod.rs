//! The context handoff a provider switch delivers: a budgeted, verbatim
//! selection of the chat's history, prepended to the first message the
//! target provider receives. Pure functions only; the send path
//! (`chat_manager/handoff_send.rs`) gathers the inputs and records the row.

pub mod budget;
pub mod items;
pub mod plan;
pub mod render;
pub mod select;
pub mod tool_items;

#[cfg(test)]
mod tests;

use std::collections::HashSet;

use mainframe_types::segment::HandoffStrategy;

pub use items::{HandoffItem, ItemKind, SpanInput};
pub use render::{HeaderInput, leading_marker_segment, strip_marker};

/// The identity half of the header; the strategy line is derived from what
/// the covered spans actually contain.
#[derive(Debug, Clone, PartialEq)]
pub struct HandoffIdentity {
    pub segment_marker: String,
    pub handoff_id: String,
    pub strategy: HandoffStrategy,
    pub title: String,
    pub chat_id: String,
    /// Whether the orchestration server's `chat_read` tool reaches the target.
    pub chat_read_available: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BuiltHandoff {
    pub block: String,
    pub item_count: u32,
    pub omitted_count: u32,
    pub used_bytes: u64,
}

/// Not even the header fits next to the user's message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the handoff header does not fit the budget")]
pub struct HandoffTooLarge;

pub fn build_handoff(
    identity: &HandoffIdentity,
    spans: &[SpanInput<'_>],
    subagent_tools: &HashSet<String>,
    budget: u64,
) -> Result<BuiltHandoff, HandoffTooLarge> {
    let mapped = items::map_items(spans, subagent_tools);
    let header = HeaderInput {
        segment_marker: identity.segment_marker.clone(),
        handoff_id: identity.handoff_id.clone(),
        strategy: identity.strategy,
        title: identity.title.clone(),
        chat_id: identity.chat_id.clone(),
        strategy_line: render::strategy_line(identity.strategy, mapped.turns, &mapped.providers),
        recovery_line: identity
            .chat_read_available
            .then(|| render::recovery_line(&identity.chat_id)),
    };
    let total = mapped.items.len();
    let header_cost = |selected: usize, omitted: usize| {
        // The empty envelope plus the separator before the user's message.
        render::render_envelope(&header, "", selected, total, omitted).len() as u64 + 2
    };
    let selection =
        select::select(&mapped.items, budget, header_cost).map_err(|_| HandoffTooLarge)?;
    let block = render::render_block(&header, &selection.items, total);
    Ok(BuiltHandoff {
        used_bytes: block.len() as u64 + 2,
        item_count: selection.items.len() as u32,
        omitted_count: selection.omitted as u32,
        block,
    })
}
