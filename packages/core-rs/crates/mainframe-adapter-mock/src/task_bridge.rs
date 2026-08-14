//! Background-task bridge for the replay adapter.
//!
//! The Claude adapter learns about background work from the CLI's own
//! `task_started` / `task_ended` notifications (see `task_events.rs`). A recording
//! has no such notifications — it only carries the sink callbacks — so until now a
//! replayed session could render a subagent card in the transcript while the
//! Activity panel insisted nothing was running. That made a whole product surface
//! (`ActivityCard`, the rail's pulse dot, `summarizeByKind`) untestable and
//! undemoable under mock mode.
//!
//! This derives the same tracker calls from the replayed message stream: a
//! `tool_use` naming a subagent tool starts a task, and the matching `tool_result`
//! ends it. Work that a recording never resolves stays running, which is exactly
//! what a fixture wants when the point is to show live work.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskSeed, TerminalUpdate};
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_types::background_task::{
    BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind,
};
use mainframe_types::chat::{MessageContent, MessageContentNode};
use mainframe_types::claude_workflow::{ClaudeWorkflowRun, ClaudeWorkflowRunStatus};

use crate::fixture::RecordedEvent;

/// Tool names that mean "a subagent is doing work", mirroring the `subagent`
/// category the adapter already advertises in its tool classification.
const SUBAGENT_TOOLS: [&str; 2] = ["Task", "Agent"];
/// The workflow tool. Its task is a `workflow` row that drills into a run panel,
/// so it also needs a run seeded in the workflow store.
const WORKFLOW_TOOL: &str = "Workflow";

pub(crate) struct TaskBridge {
    tracker: Arc<BackgroundTaskTracker>,
    workflows: Option<Arc<ClaudeWorkflowStore>>,
    /// tool_use_id → task_id, so a later tool_result can end the right task.
    started: Mutex<HashMap<String, String>>,
}

impl TaskBridge {
    pub(crate) fn new(
        tracker: Arc<BackgroundTaskTracker>,
        workflows: Option<Arc<ClaudeWorkflowStore>>,
    ) -> Self {
        Self {
            tracker,
            workflows,
            started: Mutex::new(HashMap::new()),
        }
    }

    /// Observe one recorded sink event. Unknown methods and malformed args are
    /// ignored: the bridge must never be the reason a replay stops.
    pub(crate) fn observe(&self, chat_id: &str, event: &RecordedEvent) {
        // `onWorkflowRun` is a fixture-only method: the CLI ships run structure as
        // `task_progress` snapshots the recorder never captured, so a recording
        // carries the finished `ClaudeWorkflowRun` instead. Everything downstream —
        // the run panel, the phase list, the agent grid — reads the same record.
        if event.method == "onWorkflowRun" {
            self.apply_run(chat_id, event);
            return;
        }
        let blocks: Vec<MessageContent> = match event.method.as_str() {
            "onMessage" | "onToolResult" => match event.args.first() {
                Some(value) => match serde_json::from_value(value.clone()) {
                    Ok(blocks) => blocks,
                    Err(_) => return,
                },
                None => return,
            },
            _ => return,
        };
        for block in blocks {
            let MessageContent::Node(node) = block else {
                continue;
            };
            match node {
                MessageContentNode::ToolUse {
                    id, name, input, ..
                } => self.start(chat_id, &id, &name, &input),
                MessageContentNode::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                    ..
                } => self.end(chat_id, &tool_use_id, &content, is_error),
                _ => {}
            }
        }
    }

    fn start(
        &self,
        chat_id: &str,
        tool_use_id: &str,
        name: &str,
        input: &HashMap<String, serde_json::Value>,
    ) {
        let string = |key: &str| input.get(key).and_then(|v| v.as_str()).unwrap_or_default();
        let backgrounded = input
            .get("run_in_background")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let kind = if name == WORKFLOW_TOOL {
            BackgroundWorkKind::Workflow
        } else if SUBAGENT_TOOLS.contains(&name) {
            BackgroundWorkKind::Agent
        } else if name == "Bash" && backgrounded {
            BackgroundWorkKind::Bash
        } else {
            return; // foreground work is not background work
        };
        let workflow_name = (kind == BackgroundWorkKind::Workflow).then(|| {
            let named = string("workflowName");
            if named.is_empty() {
                string("name").to_string()
            } else {
                named.to_string()
            }
        });

        // A subagent carries its instruction in `prompt`, a background shell in
        // `command`; both label themselves with `description`.
        let description = string("description");
        let command = if kind == BackgroundWorkKind::Agent {
            string("prompt")
        } else {
            string("command")
        };
        let task_id = format!("mock-{tool_use_id}");
        self.started
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(tool_use_id.to_string(), task_id.clone());
        self.tracker.start(
            chat_id,
            TaskSeed {
                id: task_id.clone(),
                kind,
                tool_name: BackgroundTaskToolName::Bash,
                tool_use_id: tool_use_id.to_string(),
                command: if command.is_empty() {
                    description.to_string()
                } else {
                    command.to_string()
                },
                description: description.to_string(),
                workflow_name: workflow_name.clone(),
            },
            String::new(),
        );
        if kind == BackgroundWorkKind::Workflow
            && let Some(workflows) = self.workflows.as_ref()
        {
            workflows.seed(chat_id, &task_id, workflow_name);
        }
    }

    /// Replace a run record wholesale from the fixture, keying it to the task the
    /// workflow tool use started so the Activity row and the run panel agree.
    fn apply_run(&self, chat_id: &str, event: &RecordedEvent) {
        let Some(workflows) = self.workflows.as_ref() else {
            return;
        };
        let Some(value) = event.args.first() else {
            return;
        };
        let Ok(run) = serde_json::from_value::<ClaudeWorkflowRun>(value.clone()) else {
            tracing::warn!("mock-cli dropped an unparseable onWorkflowRun record");
            return;
        };
        workflows.apply_record(chat_id, run);
    }

    fn end(&self, chat_id: &str, tool_use_id: &str, content: &str, is_error: bool) {
        let task_id = self
            .started
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(tool_use_id);
        let Some(task_id) = task_id else {
            return; // a result for foreground work, or for a task we never started
        };
        if let Some(workflows) = self.workflows.as_ref() {
            workflows.stamp_status(
                chat_id,
                &task_id,
                if is_error {
                    ClaudeWorkflowRunStatus::Failed
                } else {
                    ClaudeWorkflowRunStatus::Completed
                },
            );
        }
        self.tracker.end(
            chat_id,
            &task_id,
            TerminalUpdate {
                status: if is_error {
                    BackgroundTaskStatus::Failed
                } else {
                    BackgroundTaskStatus::Completed
                },
                output_path: String::new(),
                summary: content.chars().take(200).collect(),
                usage: None,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let workflows = Arc::new(ClaudeWorkflowStore::new());
        let bridge = TaskBridge::new(Arc::clone(&tracker), Some(Arc::clone(&workflows)));
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
        let workflows = Arc::new(ClaudeWorkflowStore::new());
        let bridge = TaskBridge::new(Arc::clone(&tracker), Some(Arc::clone(&workflows)));
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
}
