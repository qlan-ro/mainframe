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
pub(crate) fn handle_compaction_started(
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    state.pending_idle_legacy = false;
    sink.on_compact_start();
}

/// End-of-compaction, from either `item/completed(contextCompaction)` or the
/// legacy `thread/compacted` notification — whichever arrives first wins.
/// `vendor_id` is the item's own id (`ContextCompactionItem.id`) when the
/// v2 item path fired first; the legacy notification carries none.
pub(crate) fn handle_compaction_completed(
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
    vendor_id: Option<&str>,
) {
    if let Some(id) = vendor_id
        && !state.compact_item_ids.insert(id.to_owned())
    {
        return;
    }
    if state.maintenance.suppressing() {
        state.pending_idle_legacy = vendor_id.is_some();
        if let Some(request) = state.maintenance.request() {
            let mut metadata = request.metadata(vendor_id);
            metadata.command_uuid = None;
            if state.maintenance.record(metadata.clone()) {
                sink.on_compact_with_metadata(metadata);
            }
        }
        state.compaction_emitted = true;
        state.maintenance.finish(true);
        return;
    }
    if state.compaction_emitted {
        return;
    }
    state.compaction_emitted = true;
    sink.on_compact(vendor_id);
}

pub(crate) fn handle_legacy_compacted(
    params: &serde_json::Value,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    if matches!(
        crate::event_mapper::resolve_owner(
            params.get("threadId").and_then(serde_json::Value::as_str),
            state
        ),
        crate::event_mapper::Owner::Parent
    ) {
        handle_compaction_completed(sink, state, None);
    }
}

pub(crate) fn handle_idle_notification(
    method: &str,
    params: &serde_json::Value,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) -> bool {
    // A newer explicit request owns its completion, including legacy-only providers.
    if method == "thread/compacted"
        && is_parent(params, state)
        && state.pending_idle_legacy
        && !state.maintenance.suppressing()
    {
        state.pending_idle_legacy = false;
        return true;
    }
    if method.starts_with("item/")
        && params
            .pointer("/item/id")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|id| state.compact_item_ids.contains(id))
    {
        return true;
    }
    let turn = params
        .pointer("/turn/id")
        .and_then(serde_json::Value::as_str);
    if turn.is_some_and(|id| state.maintenance_turn_ids.contains(id))
        && !state.maintenance.suppressing()
    {
        return true;
    }
    if !state.maintenance.suppressing() {
        return false;
    }
    if !is_parent(params, state) {
        return false;
    }
    match method {
        "item/started" | "item/completed" => idle_item(method, params, sink, state),
        "thread/compacted" if state.maintenance_item_id.is_none() => {
            handle_compaction_completed(sink, state, None)
        }
        "turn/started" => {
            if let Some(id) = turn {
                state.maintenance_turn_ids.insert(id.to_owned());
            }
        }
        "turn/completed" => {
            state.maintenance.finish(false);
        }
        "thread/tokenUsage/updated" | "account/rateLimits/updated" => return false,
        _ => {}
    }
    true
}

fn is_parent(params: &serde_json::Value, state: &CodexSessionState) -> bool {
    matches!(
        crate::event_mapper::resolve_owner(
            params.get("threadId").and_then(serde_json::Value::as_str),
            state
        ),
        crate::event_mapper::Owner::Parent
    )
}
fn idle_item(
    method: &str,
    params: &serde_json::Value,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    if params
        .pointer("/item/type")
        .and_then(serde_json::Value::as_str)
        != Some("contextCompaction")
    {
        return;
    }
    let id = params
        .pointer("/item/id")
        .and_then(serde_json::Value::as_str);
    if method == "item/started" {
        if let Some(id) = id.filter(|id| !state.compact_item_ids.contains(*id)) {
            state.maintenance_item_id = Some(id.to_owned());
        }
    } else if state
        .maintenance_item_id
        .as_deref()
        .is_none_or(|expected| Some(expected) == id)
    {
        handle_compaction_completed(sink, state, id);
    }
}
