use std::collections::HashMap;
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::broadcast;

use mainframe_types::background_task::{
    BackgroundTask, BackgroundTaskStatus, BackgroundTaskToolName, BackgroundTaskUsage,
    BackgroundWorkKind,
};

/// Broadcast payload for the `background_task.started` / `.updated` / `.ended`
/// events, each carrying the chat id and the task.
#[derive(Debug, Clone)]
pub enum TaskEvent {
    Started {
        chat_id: String,
        task: BackgroundTask,
    },
    Updated {
        chat_id: String,
        task: BackgroundTask,
    },
    Ended {
        chat_id: String,
        task: BackgroundTask,
    },
}

/// The `Pick<BackgroundTask, 'id'|'kind'|'toolName'|'toolUseId'|'command'|'description'>`
/// seed passed to [`BackgroundTaskTracker::start`].
#[derive(Debug, Clone)]
pub struct TaskSeed {
    pub id: String,
    pub kind: BackgroundWorkKind,
    pub tool_name: BackgroundTaskToolName,
    pub tool_use_id: String,
    pub command: String,
    pub description: String,
    /// Set for a `local_workflow` task_type; carried onto the started
    /// `BackgroundTask` so `run_id` (learned later) has a name to sit beside.
    pub workflow_name: Option<String>,
}

/// The terminal-transition update passed to [`BackgroundTaskTracker::end`].
/// `status` is a non-running terminal status.
#[derive(Debug, Clone)]
pub struct TerminalUpdate {
    pub status: BackgroundTaskStatus,
    pub output_path: String,
    pub summary: String,
    pub usage: Option<BackgroundTaskUsage>,
}

/// Options for [`BackgroundTaskTracker::adopt`].
#[derive(Debug, Clone, Default)]
pub struct AdoptOptions {
    pub emit: bool,
}

fn is_terminal(status: BackgroundTaskStatus) -> bool {
    matches!(
        status,
        BackgroundTaskStatus::Completed
            | BackgroundTaskStatus::Failed
            | BackgroundTaskStatus::Stopped
    )
}

use mainframe_types::time::now_ms;

const EVENT_CHANNEL_CAPACITY: usize = 1024;

#[derive(Debug)]
pub struct BackgroundTaskTracker {
    pub(crate) process: crate::process::ProcessDeps,
    emitter: broadcast::Sender<TaskEvent>,
    by_chat: Arc<DashMap<String, HashMap<String, BackgroundTask>>>,
    /// Tracker-private: chatId → taskId → pid. Advisory only — every kill re-runs
    /// lsofWriters.
    pid_by_chat: Arc<DashMap<String, HashMap<String, u32>>>,
}

impl Default for BackgroundTaskTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl BackgroundTaskTracker {
    pub fn with_resolved_path(mut self, path: mainframe_runtime::ResolvedPath) -> Self {
        self.process = crate::process::ProcessDeps::new(path);
        self
    }

    pub fn new() -> Self {
        let (emitter, _rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        BackgroundTaskTracker {
            process: crate::process::ProcessDeps::default(),
            emitter,
            by_chat: Arc::new(DashMap::new()),
            pid_by_chat: Arc::new(DashMap::new()),
        }
    }

    /// Subscribe to `background_task.started` / `.updated` / `.ended` events
    /// (BROADCAST class).
    pub fn subscribe(&self) -> broadcast::Receiver<TaskEvent> {
        self.emitter.subscribe()
    }

    pub fn start(&self, chat_id: &str, seed: TaskSeed, output_path: String) -> BackgroundTask {
        let existing = self
            .by_chat
            .get(chat_id)
            .and_then(|chat| chat.get(&seed.id).cloned());
        // Duplicate start of a live task (CLI re-register on resume) → upsert, no
        // double count: keep the original startedAt and emit updated, not started.
        let (is_upsert, started_at, last_output_line) = match &existing {
            Some(e) if e.status == BackgroundTaskStatus::Running => {
                (true, e.started_at, e.last_output_line.clone())
            }
            _ => (false, now_ms(), None),
        };
        let task = BackgroundTask {
            id: seed.id,
            kind: seed.kind,
            tool_name: seed.tool_name,
            tool_use_id: seed.tool_use_id,
            command: seed.command,
            description: seed.description,
            output_path: Some(output_path),
            started_at,
            ended_at: None,
            status: BackgroundTaskStatus::Running,
            last_output_line,
            summary: None,
            usage: None,
            recovered: None,
            workflow_name: seed.workflow_name,
            run_id: None,
        };
        {
            let mut chat = self.by_chat.entry(chat_id.to_string()).or_default();
            chat.insert(task.id.clone(), task.clone());
        }
        let event = if is_upsert {
            TaskEvent::Updated {
                chat_id: chat_id.to_string(),
                task: task.clone(),
            }
        } else {
            TaskEvent::Started {
                chat_id: chat_id.to_string(),
                task: task.clone(),
            }
        };
        let _ = self.emitter.send(event);
        task
    }

    pub fn end(
        &self,
        chat_id: &str,
        task_id: &str,
        update: TerminalUpdate,
    ) -> Option<BackgroundTask> {
        let existing = self.by_chat.get(chat_id)?.get(task_id).cloned();
        let existing = existing?; // end without start — drop
        if is_terminal(existing.status) {
            return Some(existing); // dedup terminal status
        }
        // Prefer the outputPath we already have (set at start) over the late notification.
        let output_path = if update.output_path.is_empty() {
            existing.output_path.clone()
        } else {
            Some(update.output_path)
        };
        let next = BackgroundTask {
            status: update.status,
            output_path,
            summary: Some(update.summary),
            usage: update.usage,
            ended_at: Some(now_ms()),
            ..existing
        };
        if let Some(mut chat) = self.by_chat.get_mut(chat_id) {
            chat.insert(task_id.to_string(), next.clone());
        }
        let _ = self.emitter.send(TaskEvent::Ended {
            chat_id: chat_id.to_string(),
            task: next.clone(),
        });
        Some(next)
    }

    /// Learned from the `Workflow` tool result, after `start` already seeded
    /// the task with `run_id: None`. No-op when the task is unknown or
    /// already carries this `run_id`. `workflow_name` fills in only when the
    /// task doesn't already carry one — `task_started` may have preceded the
    /// CLI naming its own workflow.
    pub fn link_run_id(
        &self,
        chat_id: &str,
        task_id: &str,
        run_id: &str,
        workflow_name: Option<String>,
    ) {
        let Some(mut chat) = self.by_chat.get_mut(chat_id) else {
            return;
        };
        let Some(task) = chat.get_mut(task_id) else {
            return;
        };
        if task.run_id.as_deref() == Some(run_id) {
            return;
        }
        task.run_id = Some(run_id.to_string());
        if task.workflow_name.is_none() {
            task.workflow_name = workflow_name;
        }
        let updated = task.clone();
        drop(chat);
        let _ = self.emitter.send(TaskEvent::Updated {
            chat_id: chat_id.to_string(),
            task: updated,
        });
    }

    /// Insert a fully-formed task from reconciliation. Replaces any existing
    /// entry with the same id.
    pub fn adopt(&self, chat_id: &str, task: BackgroundTask, options: AdoptOptions) {
        {
            let mut chat = self.by_chat.entry(chat_id.to_string()).or_default();
            chat.insert(task.id.clone(), task.clone());
        }
        if options.emit {
            let event = if task.status == BackgroundTaskStatus::Running {
                TaskEvent::Started {
                    chat_id: chat_id.to_string(),
                    task,
                }
            } else {
                TaskEvent::Ended {
                    chat_id: chat_id.to_string(),
                    task,
                }
            };
            let _ = self.emitter.send(event);
        }
    }

    pub fn get(&self, chat_id: &str, task_id: &str) -> Option<BackgroundTask> {
        self.by_chat.get(chat_id)?.get(task_id).cloned()
    }

    pub fn list(&self, chat_id: &str) -> Vec<BackgroundTask> {
        match self.by_chat.get(chat_id) {
            Some(chat) => chat.values().cloned().collect(),
            None => Vec::new(),
        }
    }

    /// Running tasks only — the chat's live background-activity set.
    pub fn list_live(&self, chat_id: &str) -> Vec<BackgroundTask> {
        self.list(chat_id)
            .into_iter()
            .filter(|t| t.status == BackgroundTaskStatus::Running)
            .collect()
    }

    /// Terminal-stop every running task for a chat (CLI process ended — agents and
    /// workflows die with it; orphaned entries must not pin the working indicator).
    /// Emits `ended` per task; returns the number stopped.
    pub fn end_all_running(&self, chat_id: &str) -> u32 {
        let mut count = 0;
        for task in self.list_live(chat_id) {
            self.end(
                chat_id,
                &task.id,
                TerminalUpdate {
                    status: BackgroundTaskStatus::Stopped,
                    output_path: task.output_path.clone().unwrap_or_default(),
                    summary: "session ended".to_string(),
                    usage: None,
                },
            );
            count += 1;
        }
        count
    }

    /// Cross-chat iterator over running tasks.
    pub(crate) fn list_all_running(&self) -> Vec<(String, BackgroundTask)> {
        let mut out = Vec::new();
        for chat in self.by_chat.iter() {
            for task in chat.value().values() {
                if task.status == BackgroundTaskStatus::Running {
                    out.push((chat.key().clone(), task.clone()));
                }
            }
        }
        out
    }

    pub fn remove_chat(&self, chat_id: &str) {
        self.by_chat.remove(chat_id);
        self.pid_by_chat.remove(chat_id);
    }

    pub(crate) fn set_pid(&self, chat_id: &str, task_id: &str, pid: u32) {
        let mut m = self.pid_by_chat.entry(chat_id.to_string()).or_default();
        m.insert(task_id.to_string(), pid);
    }

    #[cfg(test)]
    pub(crate) fn get_pid(&self, chat_id: &str, task_id: &str) -> Option<u32> {
        self.pid_by_chat.get(chat_id)?.get(task_id).copied()
    }
}

#[cfg(test)]
#[path = "tracker_tests.rs"]
mod tests;
