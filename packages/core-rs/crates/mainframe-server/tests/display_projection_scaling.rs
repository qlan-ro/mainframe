//! Scaling gate (todo #376 G4 task 2). Drives the real chat-side projection
//! (`IncrementalProjector` via `MessageCache::project_display`) into the
//! hub-side encode/record pipeline — `encode_container` per changed
//! ordinal, `SessionState::apply`, `RevisionLog::record_delta` — the same
//! pieces `hub/handlers.rs::handle_display_revision` wires together for one
//! attached connection and a revision log. The deterministic proxy for "a
//! partial's cost is independent of settled history length": with an
//! identical active turn, every partial's containers-encoded count and
//! `items_compared` deltas must be identical after 100, 1,000, and 10,000
//! settled messages.
//!
//! `encode_changes` duplicates `handle_display_revision`'s conversion
//! because that function is `pub(super)` to the hub — there is no public
//! seam to call it through without the full axum `FacadeHub`, and the
//! conversion itself is a handful of lines over already-public
//! `mainframe_acp::encoder` functions.

use mainframe_acp::SessionState;
use mainframe_acp::encoder::delta::EncodedDelta;
use mainframe_acp::encoder;
use mainframe_acp::revision_log::RevisionLog;
use mainframe_chat::message_cache::MessageCache;
use mainframe_display::{DisplayDelta, DisplayProjector};
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::display::StreamingLeafKind;
use std::collections::HashMap;

const CHAT_ID: &str = "chat-1";

fn text_msg(id: &str, kind: ChatMessageType, text: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: CHAT_ID.to_string(),
        r#type: kind,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: text.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: format!("2026-01-01T00:00:00.{id}Z"),
        metadata: None,
    }
}

fn assistant_with_tool_use(id: &str, text: &str, tool_id: &str) -> ChatMessage {
    let mut msg = text_msg(id, ChatMessageType::Assistant, text);
    msg.content.push(MessageContent::Node(MessageContentNode::ToolUse {
        timing: None,
        command_execution: None,
        id: tool_id.to_string(),
        name: "Bash".to_string(),
        input: HashMap::new(),
        parent_tool_use_id: None,
    }));
    msg
}

fn tool_result_msg(id: &str, tool_id: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: CHAT_ID.to_string(),
        r#type: ChatMessageType::ToolResult,
        content: vec![MessageContent::Node(MessageContentNode::ToolResult {
            tool_use_id: tool_id.to_string(),
            content: "done".to_string(),
            is_error: false,
            structured_patch: None,
            original_file: None,
            modified_file: None,
            images: Vec::new(),
            parent_tool_use_id: None,
        })],
        timestamp: format!("2026-01-01T00:00:00.{id}Z"),
        metadata: None,
    }
}

fn settled_cache(count: usize) -> MessageCache {
    let mut cache = MessageCache::new();
    for i in 0..count {
        let msg = if i % 2 == 0 {
            text_msg(&format!("u{i}"), ChatMessageType::User, "hi")
        } else {
            text_msg(&format!("a{i}"), ChatMessageType::Assistant, "ok")
        };
        cache.append(CHAT_ID, msg);
    }
    cache
}

fn make_projector() -> Box<dyn DisplayProjector> {
    Box::new(mainframe_adapter_claude::messages::incremental::IncrementalProjector::new())
}

/// `handle_display_revision`'s "encode only `delta.changes`" conversion
/// (todo #376 G4), duplicated here (see module doc) — `streaming` lands on
/// ordinal `len - 1`.
fn encode_changes(delta: &DisplayDelta, streaming: Option<StreamingLeafKind>) -> EncodedDelta {
    assert!(!delta.full, "the scaling gate only drives incremental partials");
    let streaming_ordinal = delta.len.checked_sub(1);
    let changes = delta
        .changes
        .iter()
        .map(|(ordinal, message)| {
            let leaf = streaming.filter(|_| Some(*ordinal) == streaming_ordinal);
            (*ordinal, encoder::encode_container(message, leaf))
        })
        .collect();
    EncodedDelta {
        full: false,
        changes,
        len: delta.len,
    }
}

/// Per-partial counters the gate compares across settled-history sizes.
#[derive(Debug, PartialEq, Eq)]
struct PartialCounts {
    containers_encoded: usize,
    state_items_compared: u64,
    log_items_compared: u64,
}

fn run_active_turn(settled_len: usize) -> Vec<PartialCounts> {
    let mut cache = settled_cache(settled_len);

    // Prime the projection: the first call over the settled history is a
    // full rebuild (no prior projector state) — not itself a partial under
    // test, the same way a chat's first emission after load is.
    let baseline = cache.project_display(CHAT_ID, None, None, make_projector);
    let baseline_containers =
        encoder::encode_containers(&baseline.snapshot.materialize(), None);

    let mut state = SessionState::new();
    let mut log = RevisionLog::new("epoch".to_string());
    state.seed_containers(&baseline_containers);
    log.seed_containers(&baseline_containers);

    let mut counts = Vec::new();
    drive_active_turn(&mut cache, |delta, streaming| {
        observe_partial(&mut state, &mut log, &delta, streaming, &mut counts);
    });
    counts
}

/// One partial's measurement: encode `delta`'s changes, apply/record them
/// against the already-seeded `state`/`log`, and push the resulting counts.
fn observe_partial(
    state: &mut SessionState,
    log: &mut RevisionLog,
    delta: &DisplayDelta,
    streaming: Option<StreamingLeafKind>,
    counts: &mut Vec<PartialCounts>,
) {
    let encoded = encode_changes(delta, streaming);

    let state_before = state.items_compared();
    state.apply(&encoded, || unreachable!("seeded, incremental delta"));
    let state_items_compared = state.items_compared() - state_before;

    let log_before = log.items_compared();
    log.record_delta(&encoded, || unreachable!("seeded, incremental delta"));
    let log_items_compared = log.items_compared() - log_before;

    counts.push(PartialCounts {
        containers_encoded: encoded.changes.len(),
        state_items_compared,
        log_items_compared,
    });
}

/// The active turn: a user prompt, three growing partials of the streaming
/// reply (overlay only — never committed to the cache), then the reply's
/// tool call and its result land in the raw cache. Calls `on_partial` once
/// per `project_display` call, in order.
fn drive_active_turn(cache: &mut MessageCache, mut on_partial: impl FnMut(DisplayDelta, Option<StreamingLeafKind>)) {
    cache.append(CHAT_ID, text_msg("u-act", ChatMessageType::User, "start the task"));
    on_partial(cache.project_display(CHAT_ID, None, None, make_projector), None);

    for partial in ["I'll", "I'll check", "I'll check the file"] {
        let overlay = text_msg("a-act", ChatMessageType::Assistant, partial);
        on_partial(
            cache.project_display(CHAT_ID, Some(&overlay), None, make_projector),
            Some(StreamingLeafKind::Text),
        );
    }

    cache.append(
        CHAT_ID,
        assistant_with_tool_use("a-act", "I'll check the file", "tu-act"),
    );
    on_partial(cache.project_display(CHAT_ID, None, None, make_projector), None);

    cache.append(CHAT_ID, tool_result_msg("tr-act", "tu-act"));
    on_partial(cache.project_display(CHAT_ID, None, None, make_projector), None);
}

#[test]
fn partial_counts_are_identical_regardless_of_settled_history_length() {
    let small = run_active_turn(100);
    let medium = run_active_turn(1_000);
    let large = run_active_turn(10_000);

    assert_eq!(small.len(), medium.len());
    assert_eq!(small.len(), large.len());
    for i in 0..small.len() {
        assert_eq!(small[i], medium[i], "step {i}: 100 vs 1,000 settled messages");
        assert_eq!(small[i], large[i], "step {i}: 100 vs 10,000 settled messages");
    }

    // Sanity: the gate is not vacuous — each partial touches a handful of
    // containers, never the whole settled history.
    for step in &small {
        assert!(
            step.containers_encoded <= 2,
            "a partial should touch at most the active turn's own containers: {step:?}"
        );
    }
}
