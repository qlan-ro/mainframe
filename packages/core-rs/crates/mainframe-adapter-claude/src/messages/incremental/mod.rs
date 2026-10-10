//! `IncrementalProjector`: the production `mainframe_display::DisplayProjector`
//! (`mainframe-server`'s chat deps use it for every chat). It keeps the full
//! pipeline's per-message grouping decision and per-group conversion
//! (`message_grouping::classify_message`, `display_pipeline::convert_grouped_to_display`)
//! as its only source of per-container truth, and adds only the bookkeeping
//! needed to touch just the groups a mutation affected:
//!
//! - `group`: one container's settled fold state, plus a binary search from
//!   a raw index to its owning group.
//! - `fold`: re-derive one group's content from its raw range (shared by a
//!   fresh fold and an in-place `nested` re-conversion).
//! - `refold`: the sequential walker that opens/closes group accumulators
//!   over a raw slice.
//! - `rewind`: where a partial must start re-folding from, and the frozen
//!   aggregate state (tool ids, display ids, subject scope) below that
//!   point.
//! - `patches`: the `timing(id)` and `nested(index)` in-place patches, with
//!   the nested patch's counted fallback to a rewind.
//! - `ordinals`: renumbering and snapshot sync once a call's groups settle.
//! - `post_process`: subject backfill and per-group tool-call timing for a
//!   freshly folded tail.
//! - `projector`: wires the above into `DisplayProjector::project`.

mod fold;
mod group;
mod ordinals;
mod patches;
mod post_process;
mod projector;
mod refold;
mod rewind;

#[cfg(test)]
mod tests;

pub use projector::IncrementalProjector;
