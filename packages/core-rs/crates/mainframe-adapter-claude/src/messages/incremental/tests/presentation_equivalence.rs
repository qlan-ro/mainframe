//! Equivalence with transcript presentation metadata: `group_messages` seeds
//! `presentationSources` per raw message, re-bases them on every merge, and
//! prunes/re-indexes them alongside tool_use ids the dedupe drops. The
//! projector's chunked fold must produce the same source fields,
//! including across a settled-group refold and an in-place presentation update.

use mainframe_display::{RawChange, RawChanges};
use mainframe_types::chat::ChatMessage;
use serde_json::{Value, json};

use super::harness::*;
use crate::messages::display_pipeline::prepare_messages_for_client;

fn appended() -> RawChanges {
    let mut c = RawChanges::new();
    c.push(RawChange::Appended);
    c
}

/// The fixture shape `messages/presentation_grouping_tests.rs` uses: a Codex
/// turn's `transcriptPresentation` context on raw message metadata.
fn presented(mut message: ChatMessage, phase: &str, state: &str) -> ChatMessage {
    let context = json!({
        "version": 1, "provider": "codex", "turnId": "thread/turn", "state": state,
        "phase": phase, "finalEligible": phase == "final_answer",
    });
    message
        .metadata
        .get_or_insert_default()
        .insert("transcriptPresentation".into(), context);
    message
}

/// The source message ids the full pipeline attributes to the last
/// container — guards against the suite passing vacuously.
fn source_ids(raw: &[ChatMessage], overlay: Option<&ChatMessage>) -> Vec<String> {
    let mut combined = raw.to_vec();
    combined.extend(overlay.cloned());
    let display = prepare_messages_for_client(&combined, None);
    let Some(meta) = display.last().and_then(|m| m.metadata.as_ref()) else {
        return Vec::new();
    };
    meta.get("presentationSources")
        .and_then(|s| s.get("sources"))
        .and_then(Value::as_array)
        .map(|sources| {
            sources
                .iter()
                .filter_map(|s| s["sourceMessageId"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn presentation_sources_rebase_across_merges_partials_and_tool_dedupe() {
    let mut h = Harness::new();
    h.raw.push(user("u1", "go"));
    h.step(appended(), None);

    let work = assistant("a1", vec![text("Working"), tool_use("tu1", "Bash")]);
    h.raw.push(presented(work, "commentary", "running"));
    h.step(appended(), None);
    h.raw
        .push(tool_result_msg("r1", vec![tool_result("tu1", "ok")]));
    h.step(appended(), None);

    // A streamed partial of the final answer joins the open group as overlay.
    let partial = presented(
        assistant("a2", vec![text("Ans")]),
        "final_answer",
        "running",
    );
    h.step(RawChanges::new(), Some(&partial));
    assert_eq!(source_ids(&h.raw, Some(&partial)), ["a1", "a1", "a2"]);

    // The settled message re-sends `tu1`: the dedupe drops that block, so its
    // source goes and the later text's path shifts down by one.
    let settled = assistant("a2", vec![tool_use("tu1", "Bash"), text("Answer")]);
    h.raw.push(presented(settled, "final_answer", "running"));
    h.step(appended(), None);
    assert_eq!(source_ids(&h.raw, None), ["a1", "a1", "a2"]);

    // A second turn closes the first group; then an in-place presentation
    // update (`MessageCache::update_in_place`) re-folds the settled group.
    h.raw.push(user("u2", "next"));
    h.step(appended(), None);
    for idx in [1, 3] {
        if let Some(context) = h.raw[idx]
            .metadata
            .as_mut()
            .and_then(|m| m.get_mut("transcriptPresentation"))
        {
            context["state"] = json!("completed");
        }
    }
    let mut changes = RawChanges::new();
    changes.push(RawChange::Structural(1));
    h.step(changes, None);
}

#[test]
fn a_presented_single_message_group_matches_the_full_pipeline() {
    let mut h = Harness::new();
    h.raw.push(presented(user("u1", "go"), "work", "running"));
    h.step(appended(), None);
    let answer = assistant("a1", vec![text("Done")]);
    h.raw.push(presented(answer, "final_answer", "completed"));
    h.step(appended(), None);
    assert_eq!(source_ids(&h.raw, None), ["a1"]);
}
