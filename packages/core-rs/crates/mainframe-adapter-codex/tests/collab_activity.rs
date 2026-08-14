//! Todo #327 — red-phase adapter tests (group A). Pins the sub-agent-activity
//! lifecycle against `BackgroundTaskTracker` before `CodexSessionState` carries
//! the fields the hooks need (group B, tasks 3-6, turns this green). Payload
//! shapes copied from `tests/collab_delegation.rs` and
//! `tests/fixtures/collab-delegation-0.144.3.jsonl`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::sync::Arc;

use common::{Recorder, RegistryRow, temp_registry};
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskEvent};
use mainframe_types::background_task::BackgroundWorkKind;
use serde_json::{Value, json};

const CHAT_ID: &str = "chat-327";
const PARENT_THREAD_ID: &str = "parent-thread";

/// `CodexSessionState` wired to a fresh `BackgroundTaskTracker` and a
/// throwaway thread registry, keyed the same way `main.rs` keys a live chat.
/// Fails to compile until `background_tasks`/`mainframe_chat_id` exist on
/// `CodexSessionState` (task 4) — that compile failure is this task's red
/// observation. Kept local to this binary (not `tests/common/mod.rs`) so the
/// red state is scoped to `collab_activity` alone; every codex test binary does
/// `mod common;`, so a helper referencing not-yet-added fields there would red
/// the whole suite.
fn state_with_tracker(
    rows: &[RegistryRow<'_>],
) -> (
    tempfile::TempDir,
    Arc<BackgroundTaskTracker>,
    CodexSessionState,
) {
    let (dir, registry_deps) = temp_registry(rows);
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let state = CodexSessionState {
        registry_deps: Some(registry_deps),
        mainframe_chat_id: CHAT_ID.to_string(),
        background_tasks: Some(tracker.clone()),
        ..CodexSessionState::default()
    };
    (dir, tracker, state)
}

fn thread_started(thread_id: &str) -> Value {
    json!({ "thread": { "id": thread_id } })
}

fn sub_agent_activity(id: &str, kind: &str, child: &str, agent_path: Option<&str>) -> Value {
    json!({
        "item": {
            "type": "subAgentActivity",
            "id": id,
            "kind": kind,
            "agentThreadId": child,
            "agentPath": agent_path,
        },
        "threadId": PARENT_THREAD_ID,
    })
}

fn collab_tool_call(id: &str, tool: &str, status: &str, receivers: &[&str]) -> Value {
    json!({
        "item": {
            "type": "collabAgentToolCall",
            "id": id,
            "tool": tool,
            "status": status,
            "receiverThreadIds": receivers,
        },
        "threadId": PARENT_THREAD_ID,
    })
}

fn turn_completed(thread_id: &str, turn_id: &str, status: &str) -> Value {
    json!({
        "threadId": thread_id,
        "turn": { "id": turn_id, "status": status, "error": null },
    })
}

/// Registers the parent's own thread id so a later notification tagged with a
/// child's own thread id resolves as `Owner::Child`, not `Owner::Parent`
/// (`resolve_owner` treats an unset `state.thread_id` as "everything is the
/// parent").
fn start_parent(sink: &Arc<dyn mainframe_adapter_api::SessionSink>, state: &mut CodexSessionState) {
    handle_notification(
        "thread/started",
        &thread_started(PARENT_THREAD_ID),
        sink,
        state,
    );
}

fn open_via_sub_agent_activity(
    child: &str,
    sink: &Arc<dyn mainframe_adapter_api::SessionSink>,
    state: &mut CodexSessionState,
) {
    handle_notification(
        "item/completed",
        &sub_agent_activity("call-1", "started", child, Some("/root/compute_sum")),
        sink,
        state,
    );
}

fn collab_tool_use_blocks(rec: &Recorder) -> Vec<Value> {
    rec.messages()
        .iter()
        .flat_map(|blocks| blocks.iter())
        .map(|b| serde_json::to_value(b).expect("block serializes"))
        .filter(|v| v["type"] == "tool_use" && v["name"] == "CollabAgent")
        .collect()
}

#[test]
fn sub_agent_started_opens_one_running_agent_entry() {
    let (_dir, tracker, mut state) =
        state_with_tracker(&[("child-1", Some("Maxwell"), None, None)]);
    let rec = Recorder::new();
    let sink = rec.sink();

    open_via_sub_agent_activity("child-1", &sink, &mut state);

    let live = tracker.list_live(CHAT_ID);
    assert_eq!(
        live.len(),
        1,
        "expected exactly one live entry, got {live:?}"
    );
    assert_eq!(live[0].kind, BackgroundWorkKind::Agent);
    assert_eq!(live[0].description, "Maxwell");
}

#[test]
fn entry_description_equals_the_card_title() {
    let (_dir, tracker, mut state) =
        state_with_tracker(&[("child-1", Some("Maxwell"), None, None)]);
    let rec = Recorder::new();
    let sink = rec.sink();

    open_via_sub_agent_activity("child-1", &sink, &mut state);

    let cards = collab_tool_use_blocks(&rec);
    let subagent_type = cards[0]["input"]["subagent_type"]
        .as_str()
        .expect("subagent_type is a string");
    let live = tracker.list_live(CHAT_ID);
    assert_eq!(live[0].description, subagent_type);
}

#[test]
fn unresolved_identity_reads_sub_agent_in_both_views() {
    let (_dir, tracker, mut state) = state_with_tracker(&[]);
    let rec = Recorder::new();
    let sink = rec.sink();

    handle_notification(
        "item/completed",
        &sub_agent_activity("call-1", "started", "child-1", None),
        &sink,
        &mut state,
    );

    let cards = collab_tool_use_blocks(&rec);
    assert_eq!(cards[0]["input"]["subagent_type"], json!("Sub-agent"));
    let live = tracker.list_live(CHAT_ID);
    assert_eq!(live[0].description, "Sub-agent");
}

#[test]
fn a_late_nickname_does_not_rename_the_entry() {
    // The registry row for `child-1` is added only after the card/entry opened,
    // mirroring a nickname assignment that lands mid-session.
    let (_dir, tracker, mut state) = state_with_tracker(&[]);
    let rec = Recorder::new();
    let sink = rec.sink();

    open_via_sub_agent_activity("child-1", &sink, &mut state);
    let (_dir2, later_deps) = temp_registry(&[("child-1", Some("Maxwell"), None, None)]);
    state.registry_deps = Some(later_deps);

    handle_notification(
        "item/completed",
        &sub_agent_activity("call-1", "interacted", "child-1", None),
        &sink,
        &mut state,
    );

    // Opened via `open_via_sub_agent_activity`, whose fixed `agentPath` humanizes
    // to "compute sum" with no registry metadata (see
    // `card_title_falls_back_to_humanized_path_when_no_metadata` in
    // collab_identity.rs) — the row must keep that title, not fall back to
    // "Sub-agent" or pick up the now-available "Maxwell" nickname.
    let live = tracker.list_live(CHAT_ID);
    assert_eq!(live[0].description, "compute sum");
}

#[test]
fn spawn_call_alone_opens_no_entry() {
    let (_dir, tracker, mut state) = state_with_tracker(&[]);
    let rec = Recorder::new();
    let sink = rec.sink();

    handle_notification(
        "item/started",
        &collab_tool_call("call-1", "spawnAgent", "inProgress", &["child-1"]),
        &sink,
        &mut state,
    );

    assert!(tracker.list_live(CHAT_ID).is_empty());
}

#[test]
fn wait_naming_an_unknown_child_opens_one_entry() {
    let (_dir, tracker, mut state) = state_with_tracker(&[]);
    let rec = Recorder::new();
    let sink = rec.sink();

    handle_notification(
        "item/started",
        &collab_tool_call("call-1", "wait", "inProgress", &["child-1"]),
        &sink,
        &mut state,
    );

    let live = tracker.list_live(CHAT_ID);
    assert_eq!(live.len(), 1);
    assert_eq!(live[0].kind, BackgroundWorkKind::Agent);
}

#[test]
fn repeat_delegation_calls_add_no_entry_and_keep_started_at() {
    let (_dir, tracker, mut state) =
        state_with_tracker(&[("child-1", Some("Maxwell"), None, None)]);
    let rec = Recorder::new();
    let sink = rec.sink();

    open_via_sub_agent_activity("child-1", &sink, &mut state);
    let started_at = tracker.list_live(CHAT_ID)[0].started_at;

    handle_notification(
        "item/started",
        &collab_tool_call("call-2", "sendInput", "inProgress", &["child-1"]),
        &sink,
        &mut state,
    );
    handle_notification(
        "item/completed",
        &collab_tool_call("call-3", "resumeAgent", "completed", &["child-1"]),
        &sink,
        &mut state,
    );
    handle_notification(
        "item/started",
        &collab_tool_call("call-4", "wait", "inProgress", &["child-1"]),
        &sink,
        &mut state,
    );

    let live = tracker.list_live(CHAT_ID);
    assert_eq!(live.len(), 1);
    assert_eq!(live[0].started_at, started_at);
}

#[test]
fn completion_ends_the_entry() {
    let (_dir, tracker, mut state) =
        state_with_tracker(&[("child-1", Some("Maxwell"), None, None)]);
    let rec = Recorder::new();
    let sink = rec.sink();
    start_parent(&sink, &mut state);
    open_via_sub_agent_activity("child-1", &sink, &mut state);

    handle_notification(
        "turn/completed",
        &turn_completed("child-1", "child-turn-1", "completed"),
        &sink,
        &mut state,
    );

    assert!(tracker.list_live(CHAT_ID).is_empty());
}

#[test]
fn failure_ends_the_entry() {
    let (_dir, tracker, mut state) =
        state_with_tracker(&[("child-1", Some("Maxwell"), None, None)]);
    let rec = Recorder::new();
    let sink = rec.sink();
    start_parent(&sink, &mut state);
    open_via_sub_agent_activity("child-1", &sink, &mut state);

    handle_notification(
        "turn/completed",
        &turn_completed("child-1", "child-turn-1", "failed"),
        &sink,
        &mut state,
    );

    assert!(tracker.list_live(CHAT_ID).is_empty());
}

#[test]
fn interruption_ends_the_entry() {
    let (_dir, tracker, mut state) =
        state_with_tracker(&[("child-1", Some("Maxwell"), None, None)]);
    let rec = Recorder::new();
    let sink = rec.sink();
    open_via_sub_agent_activity("child-1", &sink, &mut state);

    handle_notification(
        "item/completed",
        &sub_agent_activity("call-2", "interrupted", "child-1", None),
        &sink,
        &mut state,
    );

    assert!(tracker.list_live(CHAT_ID).is_empty());
}

#[test]
fn close_agent_ends_the_entry() {
    let (_dir, tracker, mut state) =
        state_with_tracker(&[("child-1", Some("Maxwell"), None, None)]);
    let rec = Recorder::new();
    let sink = rec.sink();
    open_via_sub_agent_activity("child-1", &sink, &mut state);

    handle_notification(
        "item/completed",
        &collab_tool_call("call-2", "closeAgent", "completed", &["child-1"]),
        &sink,
        &mut state,
    );

    assert!(tracker.list_live(CHAT_ID).is_empty());
}

#[test]
fn re_engagement_after_end_opens_a_new_entry() {
    let (_dir, tracker, mut state) =
        state_with_tracker(&[("child-1", Some("Maxwell"), None, None)]);
    let rec = Recorder::new();
    let sink = rec.sink();
    start_parent(&sink, &mut state);
    open_via_sub_agent_activity("child-1", &sink, &mut state);
    let first = tracker.list_live(CHAT_ID)[0].clone();

    handle_notification(
        "turn/completed",
        &turn_completed("child-1", "child-turn-1", "completed"),
        &sink,
        &mut state,
    );
    assert!(tracker.list_live(CHAT_ID).is_empty());

    handle_notification(
        "item/started",
        &collab_tool_call("call-2", "sendInput", "inProgress", &["child-1"]),
        &sink,
        &mut state,
    );

    let live = tracker.list_live(CHAT_ID);
    assert_eq!(live.len(), 1);
    assert_ne!(live[0].id, first.id);
    assert!(live[0].started_at >= first.started_at);
    assert_eq!(live[0].description, first.description);
}

#[test]
fn re_engagement_after_close_agent_opens_a_new_entry() {
    let (_dir, tracker, mut state) =
        state_with_tracker(&[("child-1", Some("Maxwell"), None, None)]);
    let rec = Recorder::new();
    let sink = rec.sink();
    open_via_sub_agent_activity("child-1", &sink, &mut state);
    let first = tracker.list_live(CHAT_ID)[0].clone();

    handle_notification(
        "item/completed",
        &collab_tool_call("call-2", "closeAgent", "completed", &["child-1"]),
        &sink,
        &mut state,
    );
    assert!(tracker.list_live(CHAT_ID).is_empty());

    handle_notification(
        "item/started",
        &collab_tool_call("call-3", "sendInput", "inProgress", &["child-1"]),
        &sink,
        &mut state,
    );

    let live = tracker.list_live(CHAT_ID);
    assert_eq!(live.len(), 1);
    assert_ne!(live[0].id, first.id);
    assert_eq!(live[0].description, first.description);
}

#[test]
fn parent_turn_end_drains_every_entry() {
    let (_dir, tracker, mut state) = state_with_tracker(&[
        ("child-1", Some("Maxwell"), None, None),
        ("child-2", Some("Ada"), None, None),
    ]);
    let rec = Recorder::new();
    let sink = rec.sink();
    start_parent(&sink, &mut state);
    handle_notification(
        "item/completed",
        &sub_agent_activity("call-1", "started", "child-1", None),
        &sink,
        &mut state,
    );
    handle_notification(
        "item/completed",
        &sub_agent_activity("call-2", "started", "child-2", None),
        &sink,
        &mut state,
    );
    assert_eq!(tracker.list_live(CHAT_ID).len(), 2);

    handle_notification(
        "turn/completed",
        &turn_completed(PARENT_THREAD_ID, "parent-turn-1", "completed"),
        &sink,
        &mut state,
    );

    assert!(tracker.list_live(CHAT_ID).is_empty());
}

#[test]
fn unknown_activity_kind_and_unknown_tool_open_and_leak_nothing() {
    let (_dir, tracker, mut state) = state_with_tracker(&[]);
    let rec = Recorder::new();
    let sink = rec.sink();

    handle_notification(
        "item/completed",
        &sub_agent_activity("call-1", "paused", "child-1", None),
        &sink,
        &mut state,
    );
    handle_notification(
        "item/started",
        &collab_tool_call("call-2", "explode", "inProgress", &["child-2"]),
        &sink,
        &mut state,
    );

    assert!(tracker.list_live(CHAT_ID).is_empty());
}

#[test]
fn ending_twice_emits_one_ended_event() {
    let (_dir, tracker, mut state) =
        state_with_tracker(&[("child-1", Some("Maxwell"), None, None)]);
    let rec = Recorder::new();
    let sink = rec.sink();
    start_parent(&sink, &mut state);
    open_via_sub_agent_activity("child-1", &sink, &mut state);
    let entry_id = tracker.list_live(CHAT_ID)[0].id.clone();
    let mut rx = tracker.subscribe();

    handle_notification(
        "turn/completed",
        &turn_completed("child-1", "child-turn-1", "completed"),
        &sink,
        &mut state,
    );
    handle_notification(
        "turn/completed",
        &turn_completed(PARENT_THREAD_ID, "parent-turn-1", "completed"),
        &sink,
        &mut state,
    );

    let mut ended_for_entry = 0;
    while let Ok(ev) = rx.try_recv() {
        if let TaskEvent::Ended { task, .. } = ev
            && task.id == entry_id
        {
            ended_for_entry += 1;
        }
    }
    assert_eq!(ended_for_entry, 1);
}

#[test]
fn a_state_without_a_tracker_is_inert() {
    let (_dir, registry_deps) = temp_registry(&[("child-1", Some("Maxwell"), None, None)]);
    let mut state = CodexSessionState {
        registry_deps: Some(registry_deps),
        ..CodexSessionState::default()
    };
    let rec = Recorder::new();
    let sink = rec.sink();

    open_via_sub_agent_activity("child-1", &sink, &mut state);
    handle_notification(
        "item/completed",
        &collab_tool_call("call-2", "closeAgent", "completed", &["child-1"]),
        &sink,
        &mut state,
    );

    // No panic, and the transcript-facing card behavior is unaffected by a
    // missing tracker.
    let cards = collab_tool_use_blocks(&rec);
    assert_eq!(cards.len(), 1);
}
