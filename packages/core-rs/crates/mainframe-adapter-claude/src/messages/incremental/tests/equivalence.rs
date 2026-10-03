//! Equivalence suite (todo #376, G1 task 2): after every step, the
//! projector's snapshot and the delta-replayed mirror must equal a fresh
//! `prepare_messages_for_client` call. `Harness::step` asserts this on every
//! call, so each scenario below is really just "drive this sequence without
//! panicking".

use std::collections::HashMap;

use mainframe_display::{RawChange, RawChanges};
use mainframe_types::tool_call_timing::ToolCallTiming;
use serde_json::json;

use super::harness::*;

fn appended() -> RawChanges {
    let mut c = RawChanges::new();
    c.push(RawChange::Appended);
    c
}

#[test]
fn text_partials_grow_via_overlay_then_an_interrupted_overlay_is_removed() {
    let mut h = Harness::new();
    h.raw.push(user("u1", "go"));
    h.step(appended(), None);

    let partial1 = assistant("a1", vec![text("Hel")]);
    h.step(RawChanges::new(), Some(&partial1));
    let partial2 = assistant("a1", vec![text("Hello there")]);
    h.step(RawChanges::new(), Some(&partial2));

    // Interrupted: the overlay disappears with no raw change at all.
    h.step(RawChanges::new(), None);
}

#[test]
fn tool_calls_with_results_match_the_full_pipeline() {
    let mut h = Harness::new();
    h.raw.push(assistant(
        "a1",
        vec![text("checking"), tool_use("tu1", "Bash")],
    ));
    h.step(appended(), None);
    h.raw.push(tool_result_msg("r1", vec![tool_result("tu1", "ok")]));
    h.step(appended(), None);
}

#[test]
fn a_nested_append_to_a_settled_group_forms_a_task_group() {
    let mut h = Harness::with_categories(task_categories());
    h.raw.push(user("u1", "go"));
    h.step(appended(), None);
    h.raw.push(assistant("a1", vec![tool_use("tu1", "Task")]));
    h.step(appended(), None);
    // A third message settles group 1 (the assistant turn above).
    h.raw.push(user("u2", "thanks"));
    h.step(appended(), None);

    // `append_nested_live`: extend the settled assistant message in place.
    h.raw[1]
        .content
        .push(tool_use_with_parent("tu2", "Bash", "tu1"));
    let mut changes = RawChanges::new();
    changes.push(RawChange::Nested(1));
    h.step(changes, None);
}

fn create_input(subject: &str) -> HashMap<String, serde_json::Value> {
    HashMap::from([("subject".to_string(), json!(subject))])
}

fn update_input(task_id: &str) -> HashMap<String, serde_json::Value> {
    HashMap::from([
        ("taskId".to_string(), json!(task_id)),
        ("status".to_string(), json!("completed")),
    ])
}

#[test]
fn a_task_update_many_turns_later_resolves_its_subject_from_an_earlier_create() {
    let mut h = Harness::with_categories(task_categories());
    h.raw.push(assistant(
        "a1",
        vec![tool_use_with_input("tc1", "TaskCreate", create_input("Ship it"))],
    ));
    h.step(appended(), None);
    h.raw
        .push(tool_result_msg("r1", vec![tool_result("tc1", "Task #5 created successfully: Ship it")]));
    h.step(appended(), None);

    for i in 0..5 {
        h.raw.push(user(&format!("filler{i}"), "…"));
        h.step(appended(), None);
    }

    h.raw.push(assistant(
        "a2",
        vec![tool_use_with_input("tu1", "TaskUpdate", update_input("5"))],
    ));
    h.step(appended(), None);
    h.raw
        .push(tool_result_msg("r2", vec![tool_result("tu1", "Updated task #5 status")]));
    h.step(appended(), None);
}

#[test]
fn a_task_create_with_no_result_id_falls_back_to_sequential_ids() {
    let mut h = Harness::with_categories(task_categories());
    h.raw.push(assistant(
        "a1",
        vec![tool_use_with_input(
            "tc1",
            "TaskCreate",
            create_input("Streaming task"),
        )],
    ));
    h.step(appended(), None);
    // No tool_result yet (pending): extract_task_id finds nothing, so the
    // backfill scope falls back to its sequential counter.
    h.raw.push(assistant(
        "a2",
        vec![tool_use_with_input("tu1", "TaskUpdate", update_input("1"))],
    ));
    h.step(appended(), None);
}

#[test]
fn a_duration_marker_after_a_user_only_turn_patches_the_earlier_assistant_group() {
    let mut h = Harness::new();
    h.raw.push(assistant("a1", vec![text("reply")]));
    h.step(appended(), None);
    h.raw.push(user("u1", "ok"));
    h.step(appended(), None);
    h.raw.push(duration_marker("d1", 4200));
    h.step(appended(), None);
}

#[test]
fn a_timing_completion_on_a_settled_tool_call_patches_only_its_container() {
    let mut h = Harness::new();
    h.raw
        .push(assistant("a1", vec![tool_use("tu1", "Bash")]));
    h.step(appended(), None);
    h.raw.push(tool_result_msg("r1", vec![tool_result("tu1", "ok")]));
    h.step(appended(), None);
    h.raw.push(user("u1", "next")); // settles group 0
    h.step(appended(), None);

    set_tool_use_timing(
        &mut h.raw[0].content[0],
        ToolCallTiming {
            started_at: 1_000,
            completed_at: Some(1_200),
        },
    );
    let mut changes = RawChanges::new();
    changes.push(RawChange::Timing(
        "tu1".to_string(),
        Some(ToolCallTiming {
            started_at: 1_000,
            completed_at: Some(1_200),
        }),
    ));
    h.step(changes, None);
}

#[test]
fn a_queued_prompt_dequeue_merges_the_runs_around_it() {
    let mut h = Harness::new();
    h.raw.push(assistant("a1", vec![text("turn1")]));
    h.step(appended(), None);
    h.raw.push(user("u1", "queued"));
    h.step(appended(), None);
    h.raw.push(assistant("a2", vec![text("turn2")]));
    h.step(appended(), None);

    // Dequeue: move the queued user message to the end.
    let queued = h.raw.remove(1);
    h.raw.push(queued);
    let mut changes = RawChanges::new();
    changes.push(RawChange::Structural(1));
    h.step(changes, None);
}

#[test]
fn a_duplicate_tool_id_across_appended_groups_is_deduped_like_the_full_pipeline() {
    let mut h = Harness::new();
    h.raw
        .push(assistant("a1", vec![tool_use("dup", "Bash")]));
    h.step(appended(), None);
    h.raw.push(user("u1", "next"));
    h.step(appended(), None);
    h.raw
        .push(assistant("a2", vec![tool_use("dup", "Bash")]));
    h.step(appended(), None);
}

#[test]
fn a_nested_patch_that_would_collide_with_a_later_group_falls_back_to_a_rewind() {
    let mut h = Harness::new();
    h.raw.push(assistant("a1", vec![tool_use("a", "Bash")]));
    h.step(appended(), None);
    h.raw.push(user("u1", "mid"));
    h.step(appended(), None);
    h.raw.push(assistant("a2", vec![tool_use("b", "Bash")]));
    h.step(appended(), None);
    h.raw.push(user("u2", "end"));
    h.step(appended(), None);

    // Nested append introduces an id ("b") already owned by a later group.
    h.raw[0].content.push(tool_use("b", "Bash"));
    let mut changes = RawChanges::new();
    changes.push(RawChange::Nested(0));
    h.step(changes, None);
}

#[test]
fn a_display_id_duplicate_is_dropped_like_the_full_pipeline() {
    let mut h = Harness::new();
    h.raw.push(duration_marker_free_system("dup-id"));
    h.step(appended(), None);
    h.raw.push(user("u1", "between"));
    h.step(appended(), None);
    h.raw.push(duration_marker_free_system("dup-id"));
    h.step(appended(), None);
}

fn duration_marker_free_system(id: &str) -> mainframe_types::chat::ChatMessage {
    use mainframe_types::chat::{ChatMessage, ChatMessageType};
    ChatMessage {
        id: id.to_string(),
        chat_id: "c".to_string(),
        r#type: ChatMessageType::System,
        content: vec![text("[compact_boundary]")],
        timestamp: format!("2026-01-01T00:01:00.{id}Z"),
        metadata: None,
    }
}

#[test]
fn a_categories_change_forces_a_full_rebuild() {
    let mut h = Harness::new();
    h.raw.push(assistant("a1", vec![tool_use("tu1", "Read")]));
    h.step(appended(), None);
    h.set_categories(task_categories());
    h.step(RawChanges::new(), None);
}
