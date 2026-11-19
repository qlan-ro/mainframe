use std::collections::HashMap;

use dashmap::DashMap;
use tokio::sync::broadcast;

use mainframe_types::background_task::{
    BackgroundTask, BackgroundTaskStatus, BackgroundTaskToolName, BackgroundTaskUsage,
    BackgroundWorkKind,
};
use mainframe_types::time::now_ms;

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

/// The fields of a [`BackgroundTask`] its producer knows when the task starts.
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
/// `status` is a terminal status (anything but `Running`).
#[derive(Debug, Clone)]
pub struct TerminalUpdate {
    pub status: BackgroundTaskStatus,
    pub output_path: String,
    pub summary: String,
    pub usage: Option<BackgroundTaskUsage>,
}

const EVENT_CHANNEL_CAPACITY: usize = 1024;

#[derive(Debug)]
pub struct BackgroundTaskTracker {
    pub(crate) process: crate::process::ProcessDeps,
    emitter: broadcast::Sender<TaskEvent>,
    by_chat: DashMap<String, HashMap<String, BackgroundTask>>,
    /// chat id → task id → last pid seen writing the spool file. Advisory only:
    /// every kill probes the writers again.
    pid_by_chat: DashMap<String, HashMap<String, u32>>,
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
            by_chat: DashMap::new(),
            pid_by_chat: DashMap::new(),
        }
    }

    /// Subscribe to `background_task.started` / `.updated` / `.ended` events.
    pub fn subscribe(&self) -> broadcast::Receiver<TaskEvent> {
        self.emitter.subscribe()
    }

    /// Record a task as running. A second start of a task that is still
    /// running (the CLI re-registers tasks on resume) keeps its original
    /// `started_at` and last output line and emits `Updated` instead of
    /// `Started`.
    pub fn start(&self, chat_id: &str, seed: TaskSeed, output_path: String) -> BackgroundTask {
        let mut chat = self.by_chat.entry(chat_id.to_string()).or_default();
        let resumed = chat
            .get(&seed.id)
            .filter(|existing| existing.status == BackgroundTaskStatus::Running);
        let (started_at, last_output_line) = match resumed {
            Some(existing) => (existing.started_at, existing.last_output_line.clone()),
            None => (now_ms(), None),
        };
        let is_resume = resumed.is_some();
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
        chat.insert(task.id.clone(), task.clone());
        let chat_id = chat_id.to_string();
        self.emit(if is_resume {
            TaskEvent::Updated {
                chat_id,
                task: task.clone(),
            }
        } else {
            TaskEvent::Started {
                chat_id,
                task: task.clone(),
            }
        });
        task
    }

    /// Move a running task to a terminal status and emit `Ended`. Returns
    /// `None` for an unknown task. A task that is already terminal is
    /// returned unchanged and emits nothing, so concurrent ends (a CLI
    /// notification racing the liveness sweep or a kill) produce one event.
    pub fn end(
        &self,
        chat_id: &str,
        task_id: &str,
        update: TerminalUpdate,
    ) -> Option<BackgroundTask> {
        let mut chat = self.by_chat.get_mut(chat_id)?;
        let task = chat.get_mut(task_id)?;
        if task.status != BackgroundTaskStatus::Running {
            return Some(task.clone());
        }
        task.status = update.status;
        // A late notification may omit the path; keep the one recorded at start.
        if !update.output_path.is_empty() {
            task.output_path = Some(update.output_path);
        }
        task.summary = Some(update.summary);
        task.usage = update.usage;
        task.ended_at = Some(now_ms());
        let ended = task.clone();
        self.emit(TaskEvent::Ended {
            chat_id: chat_id.to_string(),
            task: ended.clone(),
        });
        Some(ended)
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
        self.emit(TaskEvent::Updated {
            chat_id: chat_id.to_string(),
            task: updated,
        });
    }

    /// Insert a fully-formed task from reconciliation, replacing any entry
    /// with the same id, and emit `Started` for a running task or `Ended` for
    /// a terminal one.
    pub fn adopt(&self, chat_id: &str, task: BackgroundTask) {
        let mut chat = self.by_chat.entry(chat_id.to_string()).or_default();
        chat.insert(task.id.clone(), task.clone());
        let chat_id = chat_id.to_string();
        self.emit(if task.status == BackgroundTaskStatus::Running {
            TaskEvent::Started { chat_id, task }
        } else {
            TaskEvent::Ended { chat_id, task }
        });
    }

    pub fn get(&self, chat_id: &str, task_id: &str) -> Option<BackgroundTask> {
        self.by_chat.get(chat_id)?.get(task_id).cloned()
    }

    pub fn list(&self, chat_id: &str) -> Vec<BackgroundTask> {
        self.by_chat
            .get(chat_id)
            .map(|chat| chat.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Running tasks only — the chat's live background-activity set.
    pub fn list_live(&self, chat_id: &str) -> Vec<BackgroundTask> {
        self.list(chat_id)
            .into_iter()
            .filter(|t| t.status == BackgroundTaskStatus::Running)
            .collect()
    }

    /// Stop every running task of a chat whose CLI process ended: its agents
    /// and workflows die with it, and orphaned entries must not pin the
    /// working indicator. Emits `Ended` per task.
    pub fn end_all_running(&self, chat_id: &str) {
        for task in self.list_live(chat_id) {
            self.end(
                chat_id,
                &task.id,
                TerminalUpdate {
                    status: BackgroundTaskStatus::Stopped,
                    output_path: String::new(),
                    summary: "session ended".to_string(),
                    usage: None,
                },
            );
        }
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
        self.pid_by_chat
            .entry(chat_id.to_string())
            .or_default()
            .insert(task_id.to_string(), pid);
    }

    /// Broadcast an event. Callers emit while still holding the chat's map
    /// entry, so a chat's events go out in the order its state changed;
    /// `send` never blocks and takes no map lock. A send fails only when
    /// nobody is subscribed, which is not an error for a broadcast.
    fn emit(&self, event: TaskEvent) {
        let _ = self.emitter.send(event);
    }

    #[cfg(test)]
    pub(crate) fn get_pid(&self, chat_id: &str, task_id: &str) -> Option<u32> {
        self.pid_by_chat.get(chat_id)?.get(task_id).copied()
    }
}

#[cfg(test)]
#[path = "tracker_tests.rs"]
mod tests;
