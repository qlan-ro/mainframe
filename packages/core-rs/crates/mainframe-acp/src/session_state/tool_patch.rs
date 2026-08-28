//! The tool-call half of the diff engine: two `EncodedItem::ToolCall`
//! snapshots become one `tool_call_update` patch — omit when unchanged,
//! value when it differs.

use mainframe_types::acp::tool_call::ToolCallUpdate;
use mainframe_types::acp::update::SessionUpdate;
use serde_json::Value;

use super::create_patch;
use crate::encoder::EncodedItem;

pub(super) fn tool_call_patch(prev: &EncodedItem, new: &EncodedItem) -> SessionUpdate {
    let (
        EncodedItem::ToolCall {
            id,
            title: pt,
            kind: pk,
            status: ps,
            raw_input: pri,
            content: pc,
            meta: pm,
        },
        EncodedItem::ToolCall {
            title: nt,
            kind: nk,
            status: ns,
            raw_input: nri,
            content: nc,
            meta: nm,
            ..
        },
    ) = (prev, new)
    else {
        unreachable!("tool_call_patch is only called for two ToolCall items");
    };

    SessionUpdate::ToolCallUpdate(ToolCallUpdate {
        tool_call_id: id.clone(),
        title: diff_field(pt, nt),
        kind: diff_field(pk, nk),
        status: diff_field(ps, ns),
        content: diff_field(pc, nc),
        locations: None,
        raw_input: diff_field(pri, nri),
        raw_output: None,
        meta: diff_meta(pm, nm),
    })
}

/// `omit` when unchanged, `value` when it differs — the patch grammar never
/// needs to null a tool-call field here (nothing in the encoder clears one).
fn diff_field<T: Clone + PartialEq>(prev: &T, new: &T) -> Option<Option<T>> {
    if prev == new {
        None
    } else {
        create_patch(Some(new.clone()))
    }
}

/// `meta` is itself `Option<Value>` (absent vs. present, not a patch field on
/// [`EncodedItem`]) — unlike `diff_field`, a change here can legitimately
/// null the wire field (a tool call losing its subagent-parent relation
/// would be `Some(None)`), so this compares one level deeper than
/// `create_patch` alone would.
fn diff_meta(prev: &Option<Value>, new: &Option<Value>) -> Option<Option<Value>> {
    if prev == new { None } else { Some(new.clone()) }
}
