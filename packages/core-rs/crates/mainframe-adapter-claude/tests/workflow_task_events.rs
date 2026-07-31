//! Red-phase (Task 10): pins the not-yet-existing `workflow_events` module's
//! public surface (Task 17's `task_updated_payload` / `parse_launch_result`),
//! `task_events::map_task_kind`'s workflow/agent split, and three lock-regression
//! dispatch tests that drive `events::handle_stdout` end-to-end. The pure tests
//! turn green at Task 17; the three dispatch tests stay red until Task 20 wires
//! `workflow_events` into `events.rs`/`user_event.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;
use std::time::Duration;

use mainframe_adapter_api::adapter::SessionSink;
use mainframe_adapter_claude::events::handle_stdout;
use mainframe_adapter_claude::session::ClaudeSession;
use mainframe_adapter_claude::task_events::map_task_kind;
use mainframe_adapter_claude::transcript::get_session_jsonl_path;
use mainframe_adapter_claude::workflow_events::{parse_launch_result, task_updated_payload};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_types::adapter::SessionOptions;
use mainframe_types::background_task::BackgroundWorkKind;
use mainframe_types::claude_workflow::{
    ClaudeWorkflowRun, ClaudeWorkflowRunSource, ClaudeWorkflowRunStatus,
};
use serde_json::json;

// ---- pure functions (green at Task 17) ----

#[test]
fn task_updated_payload_prefers_patch_status_over_the_top_level_status() {
    let event = json!({
        "type": "system",
        "subtype": "task_updated",
        "task_id": "w1",
        "status": "running",
        "patch": { "status": "completed", "end_time": "2026-07-30T12:00:00Z" }
    });
    let payload = task_updated_payload(&event);
    assert_eq!(payload.task_id, "w1");
    assert_eq!(payload.status, "completed");
}

#[test]
fn task_updated_payload_without_a_patch_yields_an_empty_status() {
    let event = json!({
        "type": "system",
        "subtype": "task_updated",
        "task_id": "w2",
        "status": "running"
    });
    let payload = task_updated_payload(&event);
    assert_eq!(payload.task_id, "w2");
    assert_eq!(payload.status, "");
    assert_eq!(
        mainframe_claude_workflows::status::task_update_action(&payload.status),
        mainframe_claude_workflows::status::TaskUpdateAction::End(
            mainframe_types::background_task::BackgroundTaskStatus::Stopped
        )
    );
}

#[test]
fn map_task_kind_splits_workflow_and_agent_task_types() {
    assert_eq!(
        map_task_kind(Some("local_workflow"), false),
        BackgroundWorkKind::Workflow
    );
    assert_eq!(
        map_task_kind(Some("remote_agent"), false),
        BackgroundWorkKind::Agent
    );
}

#[test]
fn parse_launch_result_extracts_the_launch_identity() {
    let text = json!({
        "type": "async_launched",
        "taskId": "task-9",
        "runId": "run-42",
        "workflowName": "todo-lane"
    })
    .to_string();
    let result = parse_launch_result(&text).unwrap();
    assert_eq!(result.task_id, "task-9");
    assert_eq!(result.run_id, "run-42");
    assert_eq!(result.workflow_name, Some("todo-lane".to_string()));
}

#[test]
fn parse_launch_result_returns_none_for_non_json_text() {
    assert!(parse_launch_result("not json").is_none());
}

#[test]
fn parse_launch_result_returns_none_without_a_run_id() {
    let text = json!({ "type": "async_launched", "taskId": "task-9" }).to_string();
    assert!(parse_launch_result(&text).is_none());
}

// ---- dispatch lock-regression tests (green at Task 20) ----

struct NoopSink;
impl SessionSink for NoopSink {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(
        &self,
        _content: Vec<mainframe_types::chat::MessageContent>,
        _metadata: Option<mainframe_types::adapter::MessageMetadata>,
    ) {
    }
    fn on_tool_result(&self, _content: Vec<mainframe_types::chat::MessageContent>) {}
    fn on_permission(&self, _request: mainframe_types::adapter::ControlRequest) {}
    fn on_result(&self, _data: mainframe_types::adapter::SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: mainframe_adapter_api::AdapterError) {}
    fn on_compact(&self) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: mainframe_types::adapter::ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: mainframe_types::context::SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<mainframe_types::chat::TodoItem>) {}
    fn on_pr_detected(&self, _pr: mainframe_types::adapter::DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: mainframe_adapter_api::adapter::LoadedSkill) {}
    fn on_subagent_child(
        &self,
        _parent_tool_use_id: &str,
        _blocks: Vec<mainframe_types::chat::MessageContent>,
    ) {
    }
}

const CHAT: &str = "mf-chat-1";

/// Pins Task 18's threading of the workflow store alongside `background_tasks`
/// into `ClaudeSession::new`. Task 18 owns adjusting this call if it settles on
/// a different constructor shape.
fn session_with_store(
    tracker: Arc<BackgroundTaskTracker>,
    store: Arc<ClaudeWorkflowStore>,
) -> Arc<ClaudeSession> {
    session_with_options(tracker, store, "/tmp", None)
}

fn session_with_options(
    tracker: Arc<BackgroundTaskTracker>,
    store: Arc<ClaudeWorkflowStore>,
    project_path: &str,
    chat_id: Option<String>,
) -> Arc<ClaudeSession> {
    let s = Arc::new(ClaudeSession::new(
        SessionOptions {
            project_path: project_path.to_string(),
            chat_id,
            mainframe_chat_id: CHAT.to_string(),
        },
        None,
        tracker,
        store,
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    ));
    s.init_weak();
    s
}

fn feed(session: &ClaudeSession, event: serde_json::Value) {
    let line = format!("{}\n", event);
    handle_stdout(session, line.as_bytes(), &NoopSink);
}

/// Runs `f` on a blocking worker and fails if it does not finish within one
/// second — the signature of a helper re-locking the non-reentrant
/// `ClaudeSessionState` mutex while its caller already holds it. `spawn_blocking`
/// rather than a raw thread so the dispatch keeps a runtime context: a bare
/// thread would panic instead of deadlock if the path ever reached
/// `spawn_terminal_reconcile`'s inner `tokio::spawn`.
fn run_with_timeout<F: FnOnce() + Send + 'static>(f: F) {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .expect("test runtime");
    runtime.block_on(async {
        tokio::time::timeout(Duration::from_secs(1), tokio::task::spawn_blocking(f))
            .await
            .expect("handle_stdout must not deadlock on ClaudeSessionState")
            .expect("dispatch panicked");
    });
}

#[test]
fn task_updated_through_patch_stamps_a_terminal_run_without_deadlocking() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let store = Arc::new(ClaudeWorkflowStore::new());
    let session = session_with_store(tracker.clone(), store);
    feed(
        &session,
        json!({ "type": "system", "subtype": "task_started", "task_id": "w1", "task_type": "local_workflow", "description": "todo lane" }),
    );

    run_with_timeout({
        let session = session.clone();
        move || {
            feed(
                &session,
                json!({
                    "type": "system",
                    "subtype": "task_updated",
                    "task_id": "w1",
                    "status": "running",
                    "patch": { "status": "completed", "end_time": "2026-07-30T12:00:00Z" }
                }),
            );
        }
    });

    let task = tracker.get(CHAT, "w1").unwrap();
    assert_eq!(
        task.status,
        mainframe_types::background_task::BackgroundTaskStatus::Completed
    );
}

#[test]
fn task_notification_stamps_a_terminal_run_without_deadlocking() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let store = Arc::new(ClaudeWorkflowStore::new());
    let session = session_with_store(tracker.clone(), store);
    feed(
        &session,
        json!({ "type": "system", "subtype": "task_started", "task_id": "w2", "task_type": "local_workflow", "description": "todo lane" }),
    );

    run_with_timeout({
        let session = session.clone();
        move || {
            feed(
                &session,
                json!({ "type": "system", "subtype": "task_notification", "task_id": "w2", "status": "completed", "summary": "ok" }),
            );
        }
    });

    let task = tracker.get(CHAT, "w2").unwrap();
    assert_eq!(
        task.status,
        mainframe_types::background_task::BackgroundTaskStatus::Completed
    );
}

#[test]
fn workflow_tool_result_links_the_tracker_and_the_workflow_store_without_deadlocking() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let store = Arc::new(ClaudeWorkflowStore::new());
    let session = session_with_store(tracker.clone(), store.clone());
    feed(
        &session,
        json!({ "type": "system", "subtype": "task_started", "task_id": "task-9", "task_type": "local_workflow", "description": "todo lane" }),
    );

    let launch_text = json!({
        "type": "async_launched",
        "taskId": "task-9",
        "runId": "run-42",
        "workflowName": "todo-lane"
    })
    .to_string();

    run_with_timeout({
        let session = session.clone();
        move || {
            feed(
                &session,
                json!({
                    "type": "user",
                    "message": {
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": "tu-workflow",
                            "content": [{ "type": "text", "text": launch_text }]
                        }]
                    }
                }),
            );
        }
    });

    let task = tracker.get(CHAT, "task-9").unwrap();
    assert_eq!(task.run_id, Some("run-42".to_string()));
    assert_eq!(task.workflow_name, Some("todo-lane".to_string()));

    let run = store
        .runs_for_chat(CHAT)
        .into_iter()
        .find(|r| r.task_id == "task-9")
        .unwrap();
    assert_eq!(run.run_id, Some("run-42".to_string()));
}

// ---- terminal reconciliation (`record_location` resolves a session id) ----

/// `get_session_jsonl_path` derives under the real `~/.claude/projects` tree, so
/// the record goes there under a tempdir-unique encoded name and the guard
/// removes it on drop, even on panic.
struct RemoveDirOnDrop(String);
impl Drop for RemoveDirOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn write_record(project_path: &str, session_id: &str, task_id: &str) -> RemoveDirOnDrop {
    let derived = get_session_jsonl_path(session_id, project_path);
    let workflows_dir = std::path::Path::new(&derived.project_dir)
        .join(session_id)
        .join("workflows");
    std::fs::create_dir_all(&workflows_dir).unwrap();
    let record = json!({
        "runId": "run-42",
        "taskId": task_id,
        "workflowName": "todo-lane",
        "status": "completed",
        "durationMs": 45_000,
        "totalTokens": 5_500,
        "workflowProgress": [
            { "type": "workflow_phase", "index": 0, "title": "Plan" },
            {
                "type": "workflow_agent",
                "index": 0,
                "label": "core-dev",
                "phaseIndex": 0,
                "agentId": "agent-alpha",
                "state": "done",
                "tokens": 5_500,
                "toolCalls": 3,
                "durationMs": 45_000
            }
        ]
    });
    std::fs::write(
        workflows_dir.join("wf_run-42.json"),
        serde_json::to_string(&record).unwrap(),
    )
    .unwrap();
    RemoveDirOnDrop(derived.project_dir)
}

async fn await_record_source(store: &ClaudeWorkflowStore, task_id: &str) -> ClaudeWorkflowRun {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let run = store
            .runs_for_chat(CHAT)
            .into_iter()
            .find(|r| r.task_id == task_id);
        if let Some(run) = run
            && run.source == ClaudeWorkflowRunSource::Record
        {
            return run;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "terminal reconcile never applied the on-disk record"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// `spawn_terminal_reconcile` only runs when `record_location` resolves, which
/// needs a CLI session id — the `chat_id: None` sessions above never reach it.
#[tokio::test(flavor = "multi_thread")]
async fn a_terminal_notification_reconciles_the_on_disk_record() {
    let dir = tempfile::tempdir().unwrap();
    let project_path = dir.path().to_string_lossy().into_owned();
    let _cleanup = write_record(&project_path, "sess-wf-1", "task-9");

    let tracker = Arc::new(BackgroundTaskTracker::new());
    let store = Arc::new(ClaudeWorkflowStore::new());
    let session = session_with_options(
        tracker,
        store.clone(),
        &project_path,
        Some("sess-wf-1".to_string()),
    );
    feed(
        &session,
        json!({ "type": "system", "subtype": "task_started", "task_id": "task-9", "task_type": "local_workflow", "description": "todo lane" }),
    );

    // `spawn_blocking` keeps the dispatch off the async worker while staying in
    // the runtime `spawn_terminal_reconcile` needs; the timeout is the same
    // non-reentrant-mutex guard the tests above use.
    let dispatch = tokio::task::spawn_blocking({
        let session = session.clone();
        move || {
            feed(
                &session,
                json!({ "type": "system", "subtype": "task_notification", "task_id": "task-9", "status": "completed", "summary": "ok" }),
            );
        }
    });
    tokio::time::timeout(Duration::from_secs(1), dispatch)
        .await
        .expect("handle_stdout must not deadlock on ClaudeSessionState")
        .unwrap();

    let run = await_record_source(&store, "task-9").await;
    assert_eq!(run.run_id, Some("run-42".to_string()));
    assert_eq!(run.phases.len(), 1);
    assert_eq!(run.agents.len(), 1);
    assert_eq!(run.status, ClaudeWorkflowRunStatus::Completed);
}
