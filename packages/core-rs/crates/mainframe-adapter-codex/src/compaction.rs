//! Live compaction mapping for Codex 0.144.3+.
//!
//! Codex emits the canonical v2 item `{"type":"contextCompaction","id":…}`
//! through the normal `item/started` → `item/completed` lifecycle (all three
//! compaction paths at rust-v0.144.3: `core/src/compact{,_remote,_remote_v2}.rs`),
//! deprecating the `thread/compacted` notification. Both end paths funnel
//! through the per-turn `compaction_emitted` gate so an old server (notification
//! only), a new server (item only), or any interleaving of the two emits the
//! "Context compacted" pill exactly once. The gate resets on `turn/started`.

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;

use crate::event_mapper::CodexSessionState;

/// `item/started(contextCompaction)` → the transient "Compacting…" pill.
pub(crate) fn handle_compaction_started(sink: &Arc<dyn SessionSink>) {
    sink.on_compact_start();
}

/// End-of-compaction, from either `item/completed(contextCompaction)` or the
/// legacy `thread/compacted` notification — whichever arrives first wins.
pub(crate) fn handle_compaction_completed(
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    if state.compaction_emitted {
        return;
    }
    state.compaction_emitted = true;
    sink.on_compact();
}
