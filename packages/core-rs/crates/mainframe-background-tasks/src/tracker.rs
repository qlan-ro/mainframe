//! Ported from `packages/core/src/background-tasks/tracker.ts`.

use std::collections::HashMap;
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::broadcast;

use mainframe_types::background_task::{
    BackgroundTask, BackgroundTaskStatus, BackgroundTaskToolName, BackgroundTaskUsage,
};

/// Broadcast payload — mirrors the TS EventEmitter's
/// `('background_task.started' | 'background_task.ended', chatId, task)`.
#[derive(Debug, Clone)]
pub enum TaskEvent {
    Started {
        chat_id: String,
        task: BackgroundTask,
    },
    Ended {
        chat_id: String,
        task: BackgroundTask,
    },
}

/// The `Pick<BackgroundTask, 'id'|'toolName'|'toolUseId'|'command'|'description'>`
/// seed passed to [`BackgroundTaskTracker::start`].
#[derive(Debug, Clone)]
pub struct TaskSeed {
    pub id: String,
    pub tool_name: BackgroundTaskToolName,
    pub tool_use_id: String,
    pub command: String,
    pub description: String,
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

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

const EVENT_CHANNEL_CAPACITY: usize = 1024;

pub struct BackgroundTaskTracker {
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
    pub fn new() -> Self {
        let (emitter, _rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        BackgroundTaskTracker {
            emitter,
            by_chat: Arc::new(DashMap::new()),
            pid_by_chat: Arc::new(DashMap::new()),
        }
    }

    /// Subscribe to `background_task.started` / `.ended` events (BROADCAST
    /// class). Replaces the TS `on(event, listener)` registration.
    pub fn subscribe(&self) -> broadcast::Receiver<TaskEvent> {
        self.emitter.subscribe()
    }

    pub fn start(&self, chat_id: &str, seed: TaskSeed, output_path: String) -> BackgroundTask {
        let task = BackgroundTask {
            id: seed.id,
            tool_name: seed.tool_name,
            tool_use_id: seed.tool_use_id,
            command: seed.command,
            description: seed.description,
            output_path: Some(output_path),
            started_at: now_ms(),
            ended_at: None,
            status: BackgroundTaskStatus::Running,
            last_output_line: None,
            summary: None,
            usage: None,
            recovered: None,
        };
        {
            let mut chat = self.by_chat.entry(chat_id.to_string()).or_default();
            chat.insert(task.id.clone(), task.clone());
        }
        let _ = self.emitter.send(TaskEvent::Started {
            chat_id: chat_id.to_string(),
            task: task.clone(),
        });
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

    /// Cross-chat iterator over running tasks.
    pub fn list_all_running(&self) -> Vec<(String, BackgroundTask)> {
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

    pub fn set_pid(&self, chat_id: &str, task_id: &str, pid: u32) {
        let mut m = self.pid_by_chat.entry(chat_id.to_string()).or_default();
        m.insert(task_id.to_string(), pid);
    }

    pub fn get_pid(&self, chat_id: &str, task_id: &str) -> Option<u32> {
        self.pid_by_chat.get(chat_id)?.get(task_id).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_seed(id: &str) -> TaskSeed {
        TaskSeed {
            id: id.to_string(),
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "tu-1".to_string(),
            command: "pnpm dev".to_string(),
            description: "dev server".to_string(),
        }
    }

    fn drain(rx: &mut broadcast::Receiver<TaskEvent>) -> Vec<TaskEvent> {
        let mut out = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            out.push(ev);
        }
        out
    }

    fn usage(total: i64, tools: i64, dur: i64) -> BackgroundTaskUsage {
        BackgroundTaskUsage {
            total_tokens: total,
            tool_uses: tools,
            duration_ms: dur,
        }
    }

    #[test]
    fn records_a_started_task_lists_it_and_emits_started() {
        let tracker = BackgroundTaskTracker::new();
        let mut rx = tracker.subscribe();
        tracker.start(
            "chat-a",
            make_seed("task-1"),
            "/tmp/spool/task-1.output".to_string(),
        );
        assert_eq!(tracker.list("chat-a").len(), 1);
        assert_eq!(
            tracker.list("chat-a")[0].status,
            BackgroundTaskStatus::Running
        );
        let events = drain(&mut rx);
        assert_eq!(events.len(), 1);
        match &events[0] {
            TaskEvent::Started { chat_id, task } => {
                assert_eq!(chat_id, "chat-a");
                assert_eq!(task.id, "task-1");
                assert_eq!(task.status, BackgroundTaskStatus::Running);
            }
            _ => panic!("expected Started"),
        }
    }

    #[test]
    fn transitions_to_completed_and_emits_ended() {
        let tracker = BackgroundTaskTracker::new();
        let mut rx = tracker.subscribe();
        tracker.start(
            "chat-a",
            make_seed("task-1"),
            "/tmp/spool/task-1.output".to_string(),
        );
        tracker.end(
            "chat-a",
            "task-1",
            TerminalUpdate {
                status: BackgroundTaskStatus::Completed,
                output_path: "/tmp/claude-501/p/s/tasks/task-1.output".to_string(),
                summary: "done".to_string(),
                usage: Some(usage(100, 1, 1000)),
            },
        );
        let t = tracker.get("chat-a", "task-1").unwrap();
        assert_eq!(t.status, BackgroundTaskStatus::Completed);
        assert_eq!(
            t.output_path.as_deref(),
            Some("/tmp/claude-501/p/s/tasks/task-1.output")
        );
        assert!(t.ended_at.unwrap() > 0);
        let events = drain(&mut rx);
        match events.last().unwrap() {
            TaskEvent::Ended { chat_id, task } => {
                assert_eq!(chat_id, "chat-a");
                assert_eq!(task, &t);
            }
            _ => panic!("expected Ended"),
        }
    }

    #[test]
    fn preserves_start_time_output_path_when_end_sends_empty_string() {
        let tracker = BackgroundTaskTracker::new();
        tracker.start(
            "chat-a",
            make_seed("task-1"),
            "/tmp/spool/task-1.output".to_string(),
        );
        tracker.end(
            "chat-a",
            "task-1",
            TerminalUpdate {
                status: BackgroundTaskStatus::Stopped,
                output_path: String::new(),
                summary: "killed".to_string(),
                usage: None,
            },
        );
        assert_eq!(
            tracker
                .get("chat-a", "task-1")
                .unwrap()
                .output_path
                .as_deref(),
            Some("/tmp/spool/task-1.output")
        );
    }

    #[test]
    fn tolerates_end_without_start() {
        let tracker = BackgroundTaskTracker::new();
        let mut rx = tracker.subscribe();
        let r = tracker.end(
            "chat-a",
            "ghost",
            TerminalUpdate {
                status: BackgroundTaskStatus::Completed,
                output_path: "x".to_string(),
                summary: String::new(),
                usage: None,
            },
        );
        assert!(r.is_none());
        assert!(tracker.list("chat-a").is_empty());
        assert!(drain(&mut rx).is_empty());
    }

    #[test]
    fn dedups_terminal_status() {
        let tracker = BackgroundTaskTracker::new();
        let mut rx = tracker.subscribe();
        tracker.start(
            "chat-a",
            make_seed("task-1"),
            "/tmp/spool/task-1.output".to_string(),
        );
        tracker.end(
            "chat-a",
            "task-1",
            TerminalUpdate {
                status: BackgroundTaskStatus::Completed,
                output_path: "x".to_string(),
                summary: String::new(),
                usage: None,
            },
        );
        let before = drain(&mut rx).len();
        tracker.end(
            "chat-a",
            "task-1",
            TerminalUpdate {
                status: BackgroundTaskStatus::Failed,
                output_path: "y".to_string(),
                summary: String::new(),
                usage: None,
            },
        );
        assert_eq!(
            drain(&mut rx).len(),
            0,
            "second end emits nothing (before={before})"
        );
        assert_eq!(
            tracker.get("chat-a", "task-1").unwrap().status,
            BackgroundTaskStatus::Completed
        );
    }

    #[test]
    fn isolates_per_chat() {
        let tracker = BackgroundTaskTracker::new();
        tracker.start("chat-a", make_seed("a"), "/tmp/spool/a.output".to_string());
        tracker.start("chat-b", make_seed("b"), "/tmp/spool/b.output".to_string());
        assert_eq!(
            tracker
                .list("chat-a")
                .into_iter()
                .map(|t| t.id)
                .collect::<Vec<_>>(),
            vec!["a"]
        );
        assert_eq!(
            tracker
                .list("chat-b")
                .into_iter()
                .map(|t| t.id)
                .collect::<Vec<_>>(),
            vec!["b"]
        );
    }

    #[test]
    fn remove_chat_drops_all_tasks() {
        let tracker = BackgroundTaskTracker::new();
        tracker.start(
            "chat-a",
            make_seed("task-1"),
            "/tmp/spool/task-1.output".to_string(),
        );
        tracker.remove_chat("chat-a");
        assert!(tracker.list("chat-a").is_empty());
    }

    fn recovered_task(
        id: &str,
        output_path: &str,
        started_at: i64,
        status: BackgroundTaskStatus,
    ) -> BackgroundTask {
        BackgroundTask {
            id: id.to_string(),
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: String::new(),
            command: "<recovered>".to_string(),
            description: String::new(),
            output_path: Some(output_path.to_string()),
            started_at,
            ended_at: None,
            status,
            last_output_line: None,
            summary: None,
            usage: None,
            recovered: Some(true),
        }
    }

    #[test]
    fn adopt_inserts_without_emitting() {
        let tracker = BackgroundTaskTracker::new();
        let mut rx = tracker.subscribe();
        tracker.adopt(
            "chat-a",
            recovered_task(
                "rec-1",
                "/tmp/claude-501/-x/sess/tasks/rec-1.output",
                1000,
                BackgroundTaskStatus::Running,
            ),
            AdoptOptions { emit: false },
        );
        assert_eq!(tracker.list("chat-a").len(), 1);
        assert_eq!(
            tracker.get("chat-a", "rec-1").unwrap().recovered,
            Some(true)
        );
        assert_eq!(tracker.get("chat-a", "rec-1").unwrap().started_at, 1000);
        assert!(drain(&mut rx).is_empty());
    }

    #[test]
    fn adopt_replaces_an_existing_entry() {
        let tracker = BackgroundTaskTracker::new();
        tracker.adopt(
            "chat-a",
            recovered_task("rec-1", "/p1", 1, BackgroundTaskStatus::Running),
            AdoptOptions::default(),
        );
        let mut replacement = recovered_task("rec-1", "/p2", 2, BackgroundTaskStatus::Stopped);
        replacement.ended_at = Some(3);
        replacement.summary = Some("gone".to_string());
        tracker.adopt("chat-a", replacement, AdoptOptions::default());
        assert_eq!(
            tracker
                .get("chat-a", "rec-1")
                .unwrap()
                .output_path
                .as_deref(),
            Some("/p2")
        );
        assert_eq!(
            tracker.get("chat-a", "rec-1").unwrap().status,
            BackgroundTaskStatus::Stopped
        );
    }

    fn plain_seed(id: &str) -> TaskSeed {
        TaskSeed {
            id: id.to_string(),
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "u".to_string(),
            command: "x".to_string(),
            description: String::new(),
        }
    }

    #[test]
    fn list_all_running_returns_every_running_task_with_chat_id() {
        let tracker = BackgroundTaskTracker::new();
        tracker.start("chat-a", plain_seed("t1"), "/p/a-t1".to_string());
        tracker.start("chat-a", plain_seed("t2"), "/p/a-t2".to_string());
        tracker.start("chat-b", plain_seed("t1"), "/p/b-t1".to_string());
        tracker.end(
            "chat-a",
            "t2",
            TerminalUpdate {
                status: BackgroundTaskStatus::Completed,
                output_path: "/p/a-t2".to_string(),
                summary: String::new(),
                usage: None,
            },
        );
        let mut all: Vec<String> = tracker
            .list_all_running()
            .into_iter()
            .map(|(chat_id, task)| format!("{chat_id}/{}", task.id))
            .collect();
        all.sort();
        assert_eq!(all, vec!["chat-a/t1", "chat-b/t1"]);
    }

    #[test]
    fn pid_map_stores_and_reads_per_chat_task() {
        let tracker = BackgroundTaskTracker::new();
        tracker.start("chat-a", plain_seed("t1"), "/p/t1.out".to_string());
        tracker.start("chat-b", plain_seed("t1"), "/p/t1.out".to_string());
        tracker.set_pid("chat-a", "t1", 111);
        tracker.set_pid("chat-b", "t1", 222);
        assert_eq!(tracker.get_pid("chat-a", "t1"), Some(111));
        assert_eq!(tracker.get_pid("chat-b", "t1"), Some(222));
        assert_eq!(tracker.get_pid("chat-a", "missing"), None);
    }

    #[test]
    fn remove_chat_clears_the_pid_map_slice() {
        let tracker = BackgroundTaskTracker::new();
        tracker.start("chat-a", plain_seed("t1"), "/p/t1.out".to_string());
        tracker.set_pid("chat-a", "t1", 111);
        tracker.remove_chat("chat-a");
        assert_eq!(tracker.get_pid("chat-a", "t1"), None);
    }

    #[test]
    fn start_stamps_the_deterministic_output_path() {
        let tracker = BackgroundTaskTracker::new();
        tracker.start(
            "chat-a",
            TaskSeed {
                id: "t9".to_string(),
                tool_name: BackgroundTaskToolName::Bash,
                tool_use_id: "u9".to_string(),
                command: "pnpm dev".to_string(),
                description: "dev server".to_string(),
            },
            "/tmp/claude-501/-Users-x-proj/sess/tasks/t9.output".to_string(),
        );
        assert_eq!(
            tracker.get("chat-a", "t9").unwrap().output_path.as_deref(),
            Some("/tmp/claude-501/-Users-x-proj/sess/tasks/t9.output")
        );
    }
}

// PORT STATUS: src/background-tasks/tracker.ts (122 lines)
// confidence: high
// todos: 0
// notes: CONCURRENCY.tsv — byChat/pidByChat = SHARED_MAP (Arc<DashMap<ChatId,
// HashMap<TaskId,_>>>); emitter = BROADCAST (tokio broadcast::Sender<TaskEvent>).
// `on(event, listener)` → `subscribe() -> broadcast::Receiver` (tests drain via
// try_recv). Locks are never held across the `.send()` (task cloned, guard
// dropped first). HashMap inner drops Map insertion order; every order-sensitive
// TS assertion sorts, so parity holds. All 15 tracker.test.ts cases translated.
