use super::*;
#[derive(Default)]
struct RecordingWorkflows(std::sync::Mutex<Vec<ClaudeWorkflowRun>>);
impl RecordingWorkflows {
    fn runs_for_chat(&self, _: &str) -> Vec<ClaudeWorkflowRun> {
        self.0.lock_recover().clone()
    }
}
impl WorkflowSink for RecordingWorkflows {
    fn seed(&self, _: &str, task: &str, name: Option<String>) {
        self.0
            .lock_recover()
            .push(ClaudeWorkflowRun::new_seed(task, name));
    }
    fn apply_record(&self, _: &str, run: ClaudeWorkflowRun) {
        *self.0.lock_recover() = vec![run];
    }
    fn stamp_status(&self, _: &str, task: &str, status: ClaudeWorkflowRunStatus) {
        for run in self
            .0
            .lock_recover()
            .iter_mut()
            .filter(|run| run.task_id == task)
        {
            run.status = status;
        }
    }
}

use serde_json::json;

fn event(method: &str, args: serde_json::Value) -> RecordedEvent {
    serde_json::from_value(json!({
        "dir": "out",
        "method": method,
        "args": args,
        "delayMs": 0,
    }))
    .expect("recorded event")
}

fn bridge() -> (TaskBridge, Arc<BackgroundTaskTracker>) {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    (TaskBridge::new(Arc::clone(&tracker), None), tracker)
}

#[test]
fn subagent_tool_use_starts_a_running_task() {
    let (bridge, tracker) = bridge();
    bridge.observe(
        "chat-1",
        &event(
            "onMessage",
            json!([[{ "type": "tool_use", "id": "toolu_1", "name": "Task",
                      "input": { "description": "Audit the cart module",
                                 "prompt": "Look for edge cases" } }]]),
        ),
    );
    let running = tracker.list_live("chat-1");
    assert_eq!(running.len(), 1);
    assert_eq!(running[0].kind, BackgroundWorkKind::Agent);
    assert_eq!(running[0].description, "Audit the cart module");
}

#[test]
fn matching_tool_result_ends_it() {
    let (bridge, tracker) = bridge();
    bridge.observe(
        "chat-1",
        &event(
            "onMessage",
            json!([[{ "type": "tool_use", "id": "toolu_1", "name": "Task", "input": {} }]]),
        ),
    );
    bridge.observe(
        "chat-1",
        &event(
            "onToolResult",
            json!([[{ "type": "tool_result", "toolUseId": "toolu_1",
                      "content": "done", "isError": false }]]),
        ),
    );
    assert!(tracker.list_live("chat-1").is_empty());
}

#[test]
fn unresolved_work_keeps_running() {
    let (bridge, tracker) = bridge();
    bridge.observe(
        "chat-1",
        &event(
            "onMessage",
            json!([[{ "type": "tool_use", "id": "a", "name": "Task", "input": {} },
                    { "type": "tool_use", "id": "b", "name": "Bash",
                      "input": { "command": "pnpm test --watch", "run_in_background": true } }]]),
        ),
    );
    bridge.observe(
        "chat-1",
        &event(
            "onToolResult",
            json!([[{ "type": "tool_result", "toolUseId": "a", "content": "ok", "isError": false }]]),
        ),
    );
    let running = tracker.list_live("chat-1");
    assert_eq!(running.len(), 1);
    assert_eq!(running[0].kind, BackgroundWorkKind::Bash);
}

#[test]
fn workflow_tool_use_starts_a_workflow_row_and_seeds_a_run() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let workflows = Arc::new(RecordingWorkflows::default());
    let bridge = TaskBridge::new(Arc::clone(&tracker), Some(workflows.clone()));
    bridge.observe(
        "chat-1",
        &event(
            "onMessage",
            json!([[{ "type": "tool_use", "id": "toolu_wf", "name": "Workflow",
                      "input": { "name": "release-readiness",
                                 "description": "Release readiness" } }]]),
        ),
    );
    let running = tracker.list_live("chat-1");
    assert_eq!(running.len(), 1);
    assert_eq!(running[0].kind, BackgroundWorkKind::Workflow);
    assert_eq!(
        running[0].workflow_name.as_deref(),
        Some("release-readiness")
    );

    let runs = workflows.runs_for_chat("chat-1");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].task_id, "mock-toolu_wf");
    assert_eq!(runs[0].status, ClaudeWorkflowRunStatus::Running);
}

#[test]
fn a_recorded_run_snapshot_replaces_the_seed() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let workflows = Arc::new(RecordingWorkflows::default());
    let bridge = TaskBridge::new(Arc::clone(&tracker), Some(workflows.clone()));
    bridge.observe(
        "chat-1",
        &event(
            "onMessage",
            json!([[{ "type": "tool_use", "id": "toolu_wf", "name": "Workflow",
                      "input": { "name": "release-readiness" } }]]),
        ),
    );
    bridge.observe(
        "chat-1",
        &event(
            "onWorkflowRun",
            json!([{ "taskId": "mock-toolu_wf", "workflowName": "release-readiness",
                     "status": "running", "source": "snapshot",
                     "totalTokens": 12000, "durationMs": 41000,
                     "phases": [{ "index": 0, "title": "Scan" }],
                     "agents": [{ "agentId": "a1", "index": 0, "phaseIndex": 0,
                                  "label": "scan:routes", "state": "done",
                                  "tokens": 4000, "toolCalls": 9, "durationMs": 12000 }] }]),
        ),
    );
    let runs = workflows.runs_for_chat("chat-1");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].phases.len(), 1);
    assert_eq!(runs[0].agents.len(), 1);
    assert_eq!(runs[0].total_tokens, 12000);
}

#[test]
fn foreground_tools_are_not_background_work() {
    let (bridge, tracker) = bridge();
    bridge.observe(
        "chat-1",
        &event(
            "onMessage",
            json!([[{ "type": "tool_use", "id": "r", "name": "Read",
                      "input": { "file_path": "index.ts" } },
                    { "type": "tool_use", "id": "s", "name": "Bash",
                      "input": { "command": "ls" } }]]),
        ),
    );
    assert!(tracker.list_live("chat-1").is_empty());
}
