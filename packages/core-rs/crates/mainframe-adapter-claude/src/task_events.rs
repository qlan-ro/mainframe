//! Bridges the CLI's `task_started` / `task_notification` system events to the
//! `BackgroundTaskTracker`. A 60s TTL cache maps a Bash/Monitor `tool_use_id` to
//! its `{ toolName, command }` so the tracker entry carries the real command.
//!
//! Concurrency: `metadata` + `eviction_timers` are owned by the session's
//! reader task. They live behind one `Arc<Mutex<Inner>>` so the spawned 60s
//! eviction task can delete its own entry without reaching the whole session
//! state.

use mainframe_types::sync::LockExt as _;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tokio::task::JoinHandle;

use mainframe_background_tasks::encoding::encode_cwd_segment;
use mainframe_background_tasks::spool_root::spool_root;
use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskSeed, TerminalUpdate};
use mainframe_claude_workflows::reconcile::{RecordLocation, spawn_terminal_reconcile};
use mainframe_claude_workflows::status::{
    TaskUpdateAction, run_status, task_update_action, terminal_task_status,
};
use mainframe_claude_workflows::store::{ClaudeWorkflowStore, ProgressUsage};
use mainframe_types::background_task::{
    BackgroundTaskToolName, BackgroundTaskUsage, BackgroundWorkKind,
};

use crate::workflow_events::TaskUpdatedPayload;

const METADATA_TTL_MS: u64 = 60_000;

struct Metadata {
    tool_name: BackgroundTaskToolName,
    command: String,
}

/// `task_started` payload subset.
pub struct TaskStartedPayload {
    pub task_id: String,
    pub tool_use_id: Option<String>,
    pub description: Option<String>,
    pub task_type: Option<String>,
    pub workflow_name: Option<String>,
}

/// Context threaded from the session at `task_started` time.
pub struct TaskStartedCtx {
    pub vendor_session_id: String,
    pub real_cwd: String,
}

/// `task_notification` usage subset.
pub struct TaskNotificationUsage {
    pub total_tokens: i64,
    pub tool_uses: i64,
    pub duration_ms: i64,
}

/// `task_notification` payload subset.
pub struct TaskNotificationPayload {
    pub task_id: String,
    pub status: String,
    pub output_file: Option<String>,
    pub summary: Option<String>,
    pub usage: Option<TaskNotificationUsage>,
}

/// CLI `task_type` → client-facing kind. Prefix-tolerant (`local_agent`,
/// `remote_agent`, teammates → agent) so new CLI variants degrade gracefully;
/// genuinely unknown types land in `Other`, never dropped.
pub fn map_task_kind(task_type: Option<&str>, has_bash_metadata: bool) -> BackgroundWorkKind {
    let Some(task_type) = task_type else {
        return if has_bash_metadata {
            BackgroundWorkKind::Bash
        } else {
            BackgroundWorkKind::Other
        };
    };
    if task_type.contains("bash") {
        BackgroundWorkKind::Bash
    } else if task_type.contains("agent") || task_type.contains("teammate") {
        BackgroundWorkKind::Agent
    } else if task_type.contains("workflow") {
        BackgroundWorkKind::Workflow
    } else {
        BackgroundWorkKind::Other
    }
}

#[derive(Default)]
struct Inner {
    metadata: HashMap<String, Metadata>,
    eviction_timers: HashMap<String, JoinHandle<()>>,
}

pub struct ClaudeTaskEvents {
    tracker: Arc<BackgroundTaskTracker>,
    workflow_store: Arc<ClaudeWorkflowStore>,
    inner: Arc<Mutex<Inner>>,
}

impl ClaudeTaskEvents {
    pub fn new(
        tracker: Arc<BackgroundTaskTracker>,
        workflow_store: Arc<ClaudeWorkflowStore>,
    ) -> Self {
        Self {
            tracker,
            workflow_store,
            inner: Arc::new(Mutex::new(Inner::default())),
        }
    }

    /// Learned from the `Workflow` tool result — updates the tracker and the
    /// workflow-run store without either reaching back into
    /// `ClaudeSessionState`.
    pub fn link_run_id(
        &self,
        chat_id: &str,
        task_id: &str,
        run_id: &str,
        workflow_name: Option<String>,
    ) {
        self.tracker
            .link_run_id(chat_id, task_id, run_id, workflow_name.clone());
        self.workflow_store
            .link_run_id(chat_id, task_id, run_id, workflow_name);
    }

    /// `task_progress`: forwards cumulative usage and an optional structure
    /// snapshot to the workflow-run store.
    pub(crate) fn apply_workflow_progress(
        &self,
        chat_id: &str,
        task_id: &str,
        usage: ProgressUsage,
        snapshot: Option<&[Value]>,
    ) {
        self.workflow_store
            .apply_progress(chat_id, task_id, usage, snapshot);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock_recover()
    }

    /// Called from events.rs for every tool_use event.
    pub(crate) fn capture_tool_use(&self, tool_use_id: &str, name: &str, input: Option<&Value>) {
        let run_in_background = input
            .and_then(|i| i.get("run_in_background"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let is_bash_bg = name == "Bash" && run_in_background;
        let is_monitor = name == "Monitor";
        if !is_bash_bg && !is_monitor {
            return;
        }
        let tool_name = if is_monitor {
            BackgroundTaskToolName::Monitor
        } else {
            BackgroundTaskToolName::Bash
        };
        let command = input
            .and_then(|i| i.get("command"))
            .and_then(Value::as_str)
            .or_else(|| {
                input
                    .and_then(|i| i.get("description"))
                    .and_then(Value::as_str)
            })
            .unwrap_or("<unknown>")
            .to_string();

        let id = tool_use_id.to_string();
        let inner = self.inner.clone();
        let evict_id = id.clone();
        // timer.unref() equivalent — a detached tokio task does not keep the
        // runtime alive.
        let timer = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(METADATA_TTL_MS)).await;
            let mut g = inner.lock_recover();
            g.metadata.remove(&evict_id);
            g.eviction_timers.remove(&evict_id);
        });
        let mut g = self.lock();
        g.metadata
            .insert(id.clone(), Metadata { tool_name, command });
        g.eviction_timers.insert(id, timer);
    }

    pub fn handle_task_started(
        &self,
        chat_id: &str,
        payload: TaskStartedPayload,
        ctx: TaskStartedCtx,
    ) {
        let meta = payload.tool_use_id.as_deref().and_then(|t| self.consume(t));
        let kind = map_task_kind(payload.task_type.as_deref(), meta.is_some());
        if kind == BackgroundWorkKind::Workflow {
            self.workflow_store
                .seed(chat_id, &payload.task_id, payload.workflow_name.clone());
        }
        let output_path = format!(
            "{}/{}/{}/tasks/{}.output",
            spool_root().to_string_lossy(),
            encode_cwd_segment(&ctx.real_cwd),
            ctx.vendor_session_id,
            payload.task_id
        );
        self.tracker.start(
            chat_id,
            TaskSeed {
                id: payload.task_id.clone(),
                kind,
                tool_name: meta
                    .as_ref()
                    .map(|m| m.tool_name)
                    .unwrap_or(BackgroundTaskToolName::Bash),
                tool_use_id: payload.tool_use_id.clone().unwrap_or_default(),
                command: meta
                    .as_ref()
                    .map(|m| m.command.clone())
                    .or_else(|| payload.description.clone())
                    .unwrap_or_else(|| "<unknown>".to_string()),
                description: payload.description.unwrap_or_default(),
                workflow_name: payload.workflow_name,
            },
            output_path,
        );
    }

    /// Stamps the workflow-run store from a CLI status string, spawning the
    /// terminal-reconcile read when the resulting run status is terminal.
    fn stamp_run(
        &self,
        chat_id: &str,
        task_id: &str,
        cli_status: &str,
        loc: Option<RecordLocation>,
    ) {
        let Some(status) = run_status(cli_status) else {
            return;
        };
        self.workflow_store.stamp_status(chat_id, task_id, status);
        if status.is_terminal()
            && let Some(loc) = loc
        {
            spawn_terminal_reconcile(
                Arc::clone(&self.workflow_store),
                chat_id.to_string(),
                task_id.to_string(),
                loc,
            );
        }
    }

    /// `task_updated` fires alongside `task_notification` (post-leak CLI addition).
    /// Only a terminal status closes the task — the tracker dedups when the
    /// notification already landed; non-terminal updates carry nothing we track.
    pub(crate) fn handle_task_updated(
        &self,
        chat_id: &str,
        payload: TaskUpdatedPayload,
        loc: Option<RecordLocation>,
    ) {
        match task_update_action(&payload.status) {
            TaskUpdateAction::Ignore => {}
            TaskUpdateAction::End(status) => {
                self.tracker.end(
                    chat_id,
                    &payload.task_id,
                    TerminalUpdate {
                        status,
                        output_path: String::new(),
                        summary: String::new(),
                        usage: None,
                    },
                );
            }
        }
        self.stamp_run(chat_id, &payload.task_id, &payload.status, loc);
    }

    pub(crate) fn handle_task_notification(
        &self,
        chat_id: &str,
        payload: TaskNotificationPayload,
        loc: Option<RecordLocation>,
    ) {
        let status = terminal_task_status(&payload.status);
        self.tracker.end(
            chat_id,
            &payload.task_id,
            TerminalUpdate {
                status,
                output_path: payload.output_file.unwrap_or_default(),
                summary: payload.summary.unwrap_or_default(),
                usage: payload.usage.map(|u| BackgroundTaskUsage {
                    total_tokens: u.total_tokens,
                    tool_uses: u.tool_uses,
                    duration_ms: u.duration_ms,
                }),
            },
        );
        self.stamp_run(chat_id, &payload.task_id, &payload.status, loc);
    }

    fn consume(&self, tool_use_id: &str) -> Option<Metadata> {
        let mut g = self.lock();
        let m = g.metadata.remove(tool_use_id)?;
        if let Some(timer) = g.eviction_timers.remove(tool_use_id) {
            timer.abort();
        }
        Some(m)
    }
}

#[cfg(test)]
#[path = "task_events_tests.rs"]
mod tests;
