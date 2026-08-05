//! Red-phase (Task 9): `store::ClaudeWorkflowStore`'s full lifecycle — seed,
//! link, progress, stamp, record reconciliation, sweep, subscribe, remove.
//! Turned green by Task 16.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::time::Duration;

use mainframe_claude_workflows::store::{ClaudeWorkflowStore, ProgressUsage};
use mainframe_types::claude_workflow::{
    ClaudeWorkflowAgentState, ClaudeWorkflowRun, ClaudeWorkflowRunSource, ClaudeWorkflowRunStatus,
};
use serde_json::{Value, json};

const CHAT: &str = "chat-1";
const TASK: &str = "task-1";

fn snapshot(state: &str, tokens: i64, duration_ms: i64) -> Vec<Value> {
    vec![
        json!({ "type": "workflow_phase", "index": 0, "title": "Plan" }),
        json!({
            "type": "workflow_agent",
            "index": 0,
            "label": "core-dev",
            "phaseIndex": 0,
            "agentId": "agent-alpha",
            "state": state,
            "tokens": tokens,
            "toolCalls": 1,
            "durationMs": duration_ms
        }),
    ]
}

fn record(task_id: &str, run_id: Option<&str>, phases_empty: bool) -> ClaudeWorkflowRun {
    let mut run = ClaudeWorkflowRun::new_seed(task_id, Some("todo-lane".to_string()));
    run.run_id = run_id.map(str::to_string);
    run.source = ClaudeWorkflowRunSource::Record;
    run.status = ClaudeWorkflowRunStatus::Completed;
    run.terminal_at = Some(1_700_000_000_000);
    run.total_tokens = 500;
    run.duration_ms = 9_000;
    if !phases_empty {
        run.phases = vec![mainframe_types::claude_workflow::ClaudeWorkflowPhase {
            index: 0,
            title: "Plan".to_string(),
            kind: None,
        }];
        run.agents = vec![mainframe_types::claude_workflow::ClaudeWorkflowAgent {
            agent_id: "agent-alpha".to_string(),
            index: 0,
            phase_index: 0,
            label: "core-dev".to_string(),
            state: ClaudeWorkflowAgentState::Done,
            model: None,
            attempt: None,
            tokens: 500,
            tool_calls: 2,
            duration_ms: 9_000,
            error: None,
            result_preview: None,
            last_tool_name: None,
            last_tool_summary: None,
            last_progress_at: None,
        }];
    }
    run
}

#[test]
fn seed_then_runs_for_chat_returns_one_running_launch_run() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, Some("todo-lane".to_string()));
    let runs = store.runs_for_chat(CHAT);
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].task_id, TASK);
    assert_eq!(runs[0].status, ClaudeWorkflowRunStatus::Running);
    assert_eq!(runs[0].source, ClaudeWorkflowRunSource::Launch);
}

#[test]
fn link_run_id_fills_run_id_and_never_overwrites_a_known_one() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.link_run_id(CHAT, TASK, "run-1", Some("todo-lane".to_string()));
    store.link_run_id(CHAT, TASK, "run-2", Some("other".to_string()));
    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.run_id, Some("run-1".to_string()));
    assert_eq!(run.workflow_name, Some("todo-lane".to_string()));
}

#[tokio::test]
async fn apply_progress_without_snapshot_advances_totals_only() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 100,
            duration_ms: 1_000,
        },
        None,
    );
    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.total_tokens, 100);
    assert_eq!(run.duration_ms, 1_000);
    assert!(run.phases.is_empty());
    assert!(run.agents.is_empty());
    assert_eq!(run.structure_revision, None);

    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 40,
            duration_ms: 500,
        },
        None,
    );
    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.total_tokens, 100);
    assert_eq!(run.duration_ms, 1_000);
}

#[tokio::test]
async fn apply_progress_with_a_snapshot_sets_structure_revision_and_replaces_structure() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 100,
            duration_ms: 5_000,
        },
        Some(&snapshot("start", 100, 5_000)),
    );
    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.structure_revision, Some(5_000));
    assert_eq!(run.agents[0].state, ClaudeWorkflowAgentState::Start);

    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 40,
            duration_ms: 2_000,
        },
        Some(&snapshot("done", 40, 2_000)),
    );
    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.structure_revision, Some(5_000));
    assert_eq!(run.agents[0].state, ClaudeWorkflowAgentState::Start);

    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 120,
            duration_ms: 5_000,
        },
        Some(&snapshot("progress", 120, 5_000)),
    );
    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.agents[0].state, ClaudeWorkflowAgentState::Progress);
}

#[test]
fn apply_progress_with_a_trailing_empty_snapshot_keeps_a_reconciled_records_structure() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.apply_record(CHAT, record(TASK, Some("run-1"), false));

    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 500,
            duration_ms: 9_000,
        },
        Some(&[]),
    );

    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.source, ClaudeWorkflowRunSource::Record);
    assert_eq!(run.phases.len(), 1);
    assert_eq!(run.agents.len(), 1);
}

#[test]
fn apply_progress_on_a_reconciled_record_still_advances_totals() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.apply_record(CHAT, record(TASK, Some("run-1"), false));

    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 900,
            duration_ms: 12_000,
        },
        Some(&[]),
    );

    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.total_tokens, 900);
    assert_eq!(run.duration_ms, 12_000);
}

#[test]
fn apply_progress_on_a_running_snapshot_run_still_accepts_a_fresher_snapshot() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 10,
            duration_ms: 1_000,
        },
        Some(&snapshot("start", 10, 1_000)),
    );

    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 20,
            duration_ms: 2_000,
        },
        Some(&snapshot("done", 20, 2_000)),
    );

    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.source, ClaudeWorkflowRunSource::Snapshot);
    assert_eq!(run.structure_revision, Some(2_000));
    assert_eq!(run.agents[0].state, ClaudeWorkflowAgentState::Done);
}

#[test]
fn stamp_status_completed_twice_is_idempotent() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.stamp_status(CHAT, TASK, ClaudeWorkflowRunStatus::Completed);
    let first = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    store.stamp_status(CHAT, TASK, ClaudeWorkflowRunStatus::Completed);
    let second = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(first.terminal_at, second.terminal_at);
    assert_eq!(first.duration_ms, second.duration_ms);
}

#[test]
fn stamp_status_paused_leaves_the_run_open_to_later_progress() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 10,
            duration_ms: 3_000,
        },
        None,
    );
    store.stamp_status(CHAT, TASK, ClaudeWorkflowRunStatus::Paused);
    let paused = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(paused.status, ClaudeWorkflowRunStatus::Paused);
    assert_eq!(paused.duration_ms, 3_000);
    assert_eq!(paused.terminal_at, None);

    // A resume from the CLI's own TUI keeps feeding this run, so the pause
    // freezes the CLI's clock — never the store's max-of-totals contract.
    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 25,
            duration_ms: 8_000,
        },
        Some(&snapshot("done", 25, 8_000)),
    );

    let resumed = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(resumed.status, ClaudeWorkflowRunStatus::Paused);
    assert_eq!(resumed.total_tokens, 25);
    assert_eq!(resumed.duration_ms, 8_000);
    assert_eq!(resumed.agents[0].state, ClaudeWorkflowAgentState::Done);
}

#[test]
fn stop_all_running_stamps_only_running_runs_and_retains_snapshots() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, "running-task", None);
    store.seed(CHAT, "terminal-task", None);
    store.apply_progress(
        CHAT,
        "terminal-task",
        ProgressUsage {
            total_tokens: 5,
            duration_ms: 1_000,
        },
        Some(&snapshot("done", 5, 1_000)),
    );
    store.stamp_status(CHAT, "terminal-task", ClaudeWorkflowRunStatus::Completed);

    store.stop_all_running(CHAT);

    let runs = store.runs_for_chat(CHAT);
    let running = runs.iter().find(|r| r.task_id == "running-task").unwrap();
    let terminal = runs.iter().find(|r| r.task_id == "terminal-task").unwrap();
    assert_eq!(running.status, ClaudeWorkflowRunStatus::Stopped);
    assert_eq!(terminal.status, ClaudeWorkflowRunStatus::Completed);
    assert_eq!(terminal.agents.len(), 1);
}

#[tokio::test]
async fn subscribe_receives_one_event_per_mutating_call_and_none_for_a_no_op() {
    let store = ClaudeWorkflowStore::new();
    let mut rx = store.subscribe();
    store.seed(CHAT, TASK, None);
    let event = tokio::time::timeout(Duration::from_millis(200), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(event.run.task_id, TASK);

    store.stamp_status(CHAT, TASK, ClaudeWorkflowRunStatus::Completed);
    tokio::time::timeout(Duration::from_millis(200), rx.recv())
        .await
        .unwrap()
        .unwrap();

    // A second terminal stamp is a no-op — no further event.
    store.stamp_status(CHAT, TASK, ClaudeWorkflowRunStatus::Completed);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), rx.recv())
            .await
            .is_err()
    );
}

#[test]
fn remove_chat_drops_the_chats_runs() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.remove_chat(CHAT);
    assert!(store.runs_for_chat(CHAT).is_empty());
}

#[test]
fn apply_record_over_a_stale_snapshot_wins_despite_a_smaller_revision() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 10,
            duration_ms: 20_000,
        },
        Some(&snapshot("start", 10, 20_000)),
    );
    store.stamp_status(CHAT, TASK, ClaudeWorkflowRunStatus::Completed);

    let mut incoming = record(TASK, Some("run-1"), false);
    incoming.duration_ms = 9_000;
    incoming.structure_revision = Some(9_000);
    store.apply_record(CHAT, incoming);

    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.source, ClaudeWorkflowRunSource::Record);
    assert!(run.agents.iter().all(|a| !matches!(
        a.state,
        ClaudeWorkflowAgentState::Start | ClaudeWorkflowAgentState::Progress
    )));
}

#[test]
fn apply_record_does_not_regress_observed_totals_and_fills_in_learned_identity() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 9_000,
            duration_ms: 60_000,
        },
        None,
    );

    let mut incoming = record(TASK, Some("run-learned"), false);
    incoming.total_tokens = 500;
    incoming.duration_ms = 9_000;
    store.apply_record(CHAT, incoming);

    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.total_tokens, 9_000);
    assert_eq!(run.duration_ms, 60_000);
    assert_eq!(run.run_id, Some("run-learned".to_string()));
}

#[tokio::test]
async fn apply_record_twice_with_the_same_record_is_a_no_op_the_second_time() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.apply_record(CHAT, record(TASK, Some("run-1"), false));
    let first = store.runs_for_chat(CHAT).into_iter().next().unwrap();

    let mut rx = store.subscribe();
    store.apply_record(CHAT, record(TASK, Some("run-1"), false));
    let second = store.runs_for_chat(CHAT).into_iter().next().unwrap();

    assert_eq!(first.terminal_at, second.terminal_at);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), rx.recv())
            .await
            .is_err()
    );
}

#[test]
fn apply_record_with_an_empty_structure_keeps_the_retained_snapshots_phases_and_agents() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 10,
            duration_ms: 4_000,
        },
        Some(&snapshot("done", 10, 4_000)),
    );

    store.apply_record(CHAT, record(TASK, Some("run-1"), true));

    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.phases.len(), 1);
    assert_eq!(run.agents.len(), 1);
    assert_eq!(run.agents[0].agent_id, "agent-alpha");
    assert_eq!(run.source, ClaudeWorkflowRunSource::Snapshot);
    assert_eq!(run.structure_revision, Some(4_000));
    assert_eq!(run.status, ClaudeWorkflowRunStatus::Completed);
    assert_eq!(run.run_id, Some("run-1".to_string()));
}

#[test]
fn apply_record_with_an_unavailable_status_leaves_the_known_retained_status_alone() {
    let store = ClaudeWorkflowStore::new();
    store.seed(CHAT, TASK, None);
    store.apply_progress(
        CHAT,
        TASK,
        ProgressUsage {
            total_tokens: 10,
            duration_ms: 1_000,
        },
        Some(&snapshot("done", 10, 1_000)),
    );
    store.stamp_status(CHAT, TASK, ClaudeWorkflowRunStatus::Completed);

    let mut incoming = record(TASK, Some("run-1"), true);
    incoming.status = ClaudeWorkflowRunStatus::Unavailable;
    store.apply_record(CHAT, incoming);

    let run = store.runs_for_chat(CHAT).into_iter().next().unwrap();
    assert_eq!(run.status, ClaudeWorkflowRunStatus::Completed);
}

#[test]
fn apply_record_for_an_unseen_task_id_inserts_the_run() {
    let store = ClaudeWorkflowStore::new();
    store.apply_record(CHAT, record("never-seeded", Some("run-x"), false));
    let runs = store.runs_for_chat(CHAT);
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].task_id, "never-seeded");
}
