//! Scaling gate (todo #376, G1 task 3): with an identical active turn, each
//! partial's `ProjectionStats` must be identical whether it follows 100,
//! 1,000, or 10,000 settled messages. This is the deterministic proxy for
//! "a partial's cost is independent of settled history length."

use mainframe_display::{
    DisplayProjector, ProjectionInput, ProjectionStats, RawChange, RawChanges,
};
use mainframe_types::chat::ChatMessage;
use mainframe_types::tool_call_timing::ToolCallTiming;

use super::harness::{
    assistant, set_tool_use_timing, text, tool_result, tool_result_msg, tool_use, user,
};
use crate::messages::incremental::IncrementalProjector;

fn settled_history(count: usize) -> Vec<ChatMessage> {
    (0..count)
        .map(|i| {
            if i % 2 == 0 {
                user(&format!("u{i}"), "hi")
            } else {
                assistant(&format!("a{i}"), vec![text("ok")])
            }
        })
        .collect()
}

fn appended() -> RawChanges {
    let mut c = RawChanges::new();
    c.push(RawChange::Appended);
    c
}

fn project(
    projector: &mut IncrementalProjector,
    raw: &[ChatMessage],
    changes: RawChanges,
) -> ProjectionStats {
    projector
        .project(ProjectionInput {
            raw,
            changes,
            overlay: None,
            categories: None,
        })
        .stats
}

/// One active turn: a growing assistant reply, a tool call, its result, and
/// a retroactive timing completion. Returns the stats from each partial,
/// in order.
fn run_active_turn(settled_len: usize) -> Vec<ProjectionStats> {
    let mut raw = settled_history(settled_len);
    let mut projector = IncrementalProjector::new();
    project(&mut projector, &raw, RawChanges::new()); // seed the full rebuild

    let mut stats = Vec::new();
    raw.push(assistant("act", vec![text("Thinking")]));
    stats.push(project(&mut projector, &raw, appended()));

    raw[settled_len] = assistant("act", vec![text("Thinking it through")]);
    stats.push(project(&mut projector, &raw, appended()));

    raw[settled_len].content.push(tool_use("tu_act", "Bash"));
    stats.push(project(&mut projector, &raw, appended()));

    raw.push(tool_result_msg(
        "tr_act",
        vec![tool_result("tu_act", "done")],
    ));
    stats.push(project(&mut projector, &raw, appended()));

    let timing = ToolCallTiming {
        started_at: 1,
        completed_at: Some(2),
    };
    set_tool_use_timing(&mut raw[settled_len].content[1], timing);
    let mut changes = RawChanges::new();
    changes.push(RawChange::Timing("tu_act".to_string(), Some(timing)));
    stats.push(project(&mut projector, &raw, changes));

    stats
}

#[test]
fn partial_stats_are_identical_regardless_of_settled_history_length() {
    let small = run_active_turn(100);
    let medium = run_active_turn(1_000);
    let large = run_active_turn(10_000);

    for i in 0..small.len() {
        assert_eq!(
            small[i].raw_folded, medium[i].raw_folded,
            "step {i} raw_folded"
        );
        assert_eq!(
            small[i].raw_folded, large[i].raw_folded,
            "step {i} raw_folded"
        );
        assert_eq!(
            small[i].groups_rebuilt, medium[i].groups_rebuilt,
            "step {i} groups_rebuilt"
        );
        assert_eq!(
            small[i].groups_rebuilt, large[i].groups_rebuilt,
            "step {i} groups_rebuilt"
        );
        assert_eq!(
            small[i].containers_patched, medium[i].containers_patched,
            "step {i} containers_patched"
        );
        assert_eq!(
            small[i].containers_patched, large[i].containers_patched,
            "step {i} containers_patched"
        );
    }

    // The retroactive timing step (the last one) patches exactly one
    // container and rebuilds no groups.
    let timing_step = small.last().expect("at least one step");
    assert_eq!(timing_step.groups_rebuilt, 0);
    assert_eq!(timing_step.containers_patched, 1);
}
