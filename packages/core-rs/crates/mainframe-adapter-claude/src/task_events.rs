//! Ported from `packages/core/src/plugins/builtin/claude/task-events.ts`.
//!
//! Bridges the CLI's `task_started` / `task_notification` system events to the
//! `BackgroundTaskTracker`. A 60s TTL cache maps a Bash/Monitor `tool_use_id` to
//! its `{ toolName, command }` so the tracker entry carries the real command.
//!
//! Concurrency (CONCURRENCY.tsv rows 91-92): `metadata` + `evictionTimers` are
//! SINGLE_TASK, owned by the session's reader task. Here they live behind one
//! `Arc<Mutex<Inner>>` so the spawned 60s eviction task can delete its own entry
//! (mirroring the TS `setTimeout` closure capturing `this`) without reaching the
//! whole session state.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tokio::task::JoinHandle;

use mainframe_background_tasks::encoding::encode_cwd_segment;
use mainframe_background_tasks::spool_root::spool_root;
use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskSeed, TerminalUpdate};
use mainframe_types::background_task::{
    BackgroundTaskStatus, BackgroundTaskToolName, BackgroundTaskUsage, BackgroundWorkKind,
};

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
}

/// `task_updated` payload subset.
pub struct TaskUpdatedPayload {
    pub task_id: String,
    pub status: String,
}

/// Context threaded from the session at `task_started` time.
pub struct TaskStartedCtx {
    pub claude_session_id: String,
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

fn map_status(s: &str) -> BackgroundTaskStatus {
    match s {
        "completed" => BackgroundTaskStatus::Completed,
        "failed" => BackgroundTaskStatus::Failed,
        "stopped" => BackgroundTaskStatus::Stopped,
        _ => {
            tracing::warn!(
                status = %s,
                "unknown task_notification status, defaulting to stopped"
            );
            BackgroundTaskStatus::Stopped
        }
    }
}

#[derive(Default)]
struct Inner {
    metadata: HashMap<String, Metadata>,
    eviction_timers: HashMap<String, JoinHandle<()>>,
}

pub struct ClaudeTaskEvents {
    tracker: Arc<BackgroundTaskTracker>,
    inner: Arc<Mutex<Inner>>,
}

impl ClaudeTaskEvents {
    pub fn new(tracker: Arc<BackgroundTaskTracker>) -> Self {
        Self {
            tracker,
            inner: Arc::new(Mutex::new(Inner::default())),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Called from events.rs for every tool_use event.
    pub fn capture_tool_use(&self, tool_use_id: &str, name: &str, input: Option<&Value>) {
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
            let mut g = inner.lock().unwrap_or_else(|e| e.into_inner());
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
        let output_path = format!(
            "{}/{}/{}/tasks/{}.output",
            spool_root().to_string_lossy(),
            encode_cwd_segment(&ctx.real_cwd),
            ctx.claude_session_id,
            payload.task_id
        );
        self.tracker.start(
            chat_id,
            TaskSeed {
                id: payload.task_id.clone(),
                kind: map_task_kind(payload.task_type.as_deref(), meta.is_some()),
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
            },
            output_path,
        );
    }

    /// `task_updated` fires alongside `task_notification` (post-leak CLI addition).
    /// Only a terminal status closes the task — the tracker dedups when the
    /// notification already landed; non-terminal updates carry nothing we track.
    pub fn handle_task_updated(&self, chat_id: &str, payload: TaskUpdatedPayload) {
        if !matches!(payload.status.as_str(), "completed" | "failed" | "stopped") {
            return;
        }
        self.tracker.end(
            chat_id,
            &payload.task_id,
            TerminalUpdate {
                status: map_status(&payload.status),
                output_path: String::new(),
                summary: String::new(),
                usage: None,
            },
        );
    }

    pub fn handle_task_notification(&self, chat_id: &str, payload: TaskNotificationPayload) {
        self.tracker.end(
            chat_id,
            &payload.task_id,
            TerminalUpdate {
                status: map_status(&payload.status),
                output_path: payload.output_file.unwrap_or_default(),
                summary: payload.summary.unwrap_or_default(),
                usage: payload.usage.map(|u| BackgroundTaskUsage {
                    total_tokens: u.total_tokens,
                    tool_uses: u.tool_uses,
                    duration_ms: u.duration_ms,
                }),
            },
        );
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
mod tests {
    use super::*;

    const SESS: &str = "sess-uuid";
    const CWD: &str = "/Users/x/proj";

    fn ctx() -> TaskStartedCtx {
        TaskStartedCtx {
            claude_session_id: SESS.to_string(),
            real_cwd: CWD.to_string(),
        }
    }

    fn started(task_id: &str, tool_use_id: &str, description: &str) -> TaskStartedPayload {
        TaskStartedPayload {
            task_id: task_id.to_string(),
            tool_use_id: Some(tool_use_id.to_string()),
            description: Some(description.to_string()),
            task_type: None,
        }
    }

    #[tokio::test(start_paused = true)]
    async fn captures_bash_run_in_background_into_metadata_cache() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.capture_tool_use(
            "tu-1",
            "Bash",
            Some(&serde_json::json!({ "command": "pnpm dev", "description": "dev", "run_in_background": true })),
        );
        te.handle_task_started("chat-a", started("t-1", "tu-1", "dev"), ctx());
        let task = tracker.get("chat-a", "t-1").unwrap();
        assert_eq!(task.tool_name, BackgroundTaskToolName::Bash);
        assert_eq!(task.command, "pnpm dev");
        assert_eq!(task.description, "dev");
    }

    #[tokio::test(start_paused = true)]
    async fn captures_monitor_tool_use() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.capture_tool_use(
            "tu-2",
            "Monitor",
            Some(&serde_json::json!({ "command": "tail -f /tmp/log", "description": "log tail" })),
        );
        te.handle_task_started("chat-a", started("t-2", "tu-2", "log tail"), ctx());
        assert_eq!(
            tracker.get("chat-a", "t-2").unwrap().tool_name,
            BackgroundTaskToolName::Monitor
        );
    }

    #[tokio::test(start_paused = true)]
    async fn ignores_non_background_bash() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.capture_tool_use(
            "tu-x",
            "Bash",
            Some(&serde_json::json!({ "command": "ls" })),
        );
        te.handle_task_started("chat-a", started("t-x", "tu-x", "ls listing"), ctx());
        let task = tracker.get("chat-a", "t-x").unwrap();
        assert_eq!(task.tool_name, BackgroundTaskToolName::Bash);
        assert_eq!(task.command, "ls listing");
    }

    #[tokio::test(start_paused = true)]
    async fn evicts_metadata_cache_after_60s_ttl() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.capture_tool_use(
            "tu-3",
            "Bash",
            Some(&serde_json::json!({ "command": "sleep 5", "run_in_background": true })),
        );
        // Let the spawned eviction task register its 60s sleep before advancing.
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_millis(60_001)).await;
        tokio::task::yield_now().await;
        te.handle_task_started("chat-a", started("t-3", "tu-3", "sleeper"), ctx());
        let task = tracker.get("chat-a", "t-3").unwrap();
        assert_eq!(task.tool_name, BackgroundTaskToolName::Bash);
        assert_eq!(task.command, "sleeper");
    }

    #[tokio::test(start_paused = true)]
    async fn handles_task_notification_with_all_fields() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.capture_tool_use(
            "tu-4",
            "Bash",
            Some(&serde_json::json!({ "command": "gulp build", "run_in_background": true })),
        );
        te.handle_task_started("chat-a", started("t-4", "tu-4", "build"), ctx());
        te.handle_task_notification(
            "chat-a",
            TaskNotificationPayload {
                task_id: "t-4".to_string(),
                status: "completed".to_string(),
                output_file: Some("/tmp/claude-501/p/s/tasks/t-4.output".to_string()),
                summary: Some("ok".to_string()),
                usage: Some(TaskNotificationUsage {
                    total_tokens: 100,
                    tool_uses: 1,
                    duration_ms: 500,
                }),
            },
        );
        let task = tracker.get("chat-a", "t-4").unwrap();
        assert_eq!(task.status, BackgroundTaskStatus::Completed);
        assert_eq!(
            task.output_path.as_deref(),
            Some("/tmp/claude-501/p/s/tasks/t-4.output")
        );
        assert_eq!(task.summary.as_deref(), Some("ok"));
    }

    #[tokio::test(start_paused = true)]
    async fn normalizes_empty_output_file_preserving_start_path() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.capture_tool_use(
            "tu-5",
            "Bash",
            Some(&serde_json::json!({ "command": "pnpm dev", "run_in_background": true })),
        );
        te.handle_task_started("chat-a", started("t-5", "tu-5", "dev"), ctx());
        let started_path = tracker.get("chat-a", "t-5").unwrap().output_path.unwrap();
        assert!(started_path.ends_with("t-5.output"));
        te.handle_task_notification(
            "chat-a",
            TaskNotificationPayload {
                task_id: "t-5".to_string(),
                status: "stopped".to_string(),
                output_file: Some(String::new()),
                summary: Some("killed".to_string()),
                usage: None,
            },
        );
        assert_eq!(
            tracker.get("chat-a", "t-5").unwrap().output_path,
            Some(started_path)
        );
    }

    #[tokio::test(start_paused = true)]
    async fn maps_unknown_status_to_stopped() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.capture_tool_use(
            "tu-6",
            "Bash",
            Some(&serde_json::json!({ "command": "x", "run_in_background": true })),
        );
        te.handle_task_started("chat-a", started("t-6", "tu-6", "x"), ctx());
        te.handle_task_notification(
            "chat-a",
            TaskNotificationPayload {
                task_id: "t-6".to_string(),
                status: "aborted".to_string(),
                output_file: Some(String::new()),
                summary: Some(String::new()),
                usage: None,
            },
        );
        assert_eq!(
            tracker.get("chat-a", "t-6").unwrap().status,
            BackgroundTaskStatus::Stopped
        );
    }

    fn started_typed(task_id: &str, task_type: Option<&str>) -> TaskStartedPayload {
        TaskStartedPayload {
            task_id: task_id.to_string(),
            tool_use_id: None,
            description: Some("x".to_string()),
            task_type: task_type.map(str::to_string),
        }
    }

    // Translated from task-events.test.ts's "background work kind mapping" block.

    #[tokio::test(start_paused = true)]
    async fn maps_local_bash_to_bash() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.handle_task_started("chat-a", started_typed("b1", Some("local_bash")), ctx());
        assert_eq!(
            tracker.get("chat-a", "b1").unwrap().kind,
            BackgroundWorkKind::Bash
        );
    }

    #[tokio::test(start_paused = true)]
    async fn maps_local_agent_to_agent() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.handle_task_started("chat-a", started_typed("a1", Some("local_agent")), ctx());
        assert_eq!(
            tracker.get("chat-a", "a1").unwrap().kind,
            BackgroundWorkKind::Agent
        );
    }

    #[tokio::test(start_paused = true)]
    async fn maps_remote_agents_and_teammates_to_agent() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.handle_task_started("chat-a", started_typed("a2", Some("remote_agent")), ctx());
        te.handle_task_started("chat-a", started_typed("a3", Some("teammate")), ctx());
        assert_eq!(
            tracker.get("chat-a", "a2").unwrap().kind,
            BackgroundWorkKind::Agent
        );
        assert_eq!(
            tracker.get("chat-a", "a3").unwrap().kind,
            BackgroundWorkKind::Agent
        );
    }

    #[tokio::test(start_paused = true)]
    async fn maps_local_workflow_to_workflow() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.handle_task_started("chat-a", started_typed("w1", Some("local_workflow")), ctx());
        assert_eq!(
            tracker.get("chat-a", "w1").unwrap().kind,
            BackgroundWorkKind::Workflow
        );
    }

    #[tokio::test(start_paused = true)]
    async fn maps_unknown_task_type_to_other() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.handle_task_started("chat-a", started_typed("o1", Some("local_quantum")), ctx());
        assert_eq!(
            tracker.get("chat-a", "o1").unwrap().kind,
            BackgroundWorkKind::Other
        );
    }

    #[tokio::test(start_paused = true)]
    async fn falls_back_to_bash_when_task_type_missing_but_bash_tool_use_captured() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.capture_tool_use(
            "tu-k",
            "Bash",
            Some(&serde_json::json!({ "command": "pnpm dev", "run_in_background": true })),
        );
        te.handle_task_started(
            "chat-a",
            TaskStartedPayload {
                task_id: "k1".to_string(),
                tool_use_id: Some("tu-k".to_string()),
                description: Some("dev".to_string()),
                task_type: None,
            },
            ctx(),
        );
        assert_eq!(
            tracker.get("chat-a", "k1").unwrap().kind,
            BackgroundWorkKind::Bash
        );
    }

    #[tokio::test(start_paused = true)]
    async fn maps_missing_task_type_with_no_captured_tool_use_to_other() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.handle_task_started("chat-a", started_typed("k2", None), ctx());
        assert_eq!(
            tracker.get("chat-a", "k2").unwrap().kind,
            BackgroundWorkKind::Other
        );
    }

    // Translated from task-events.test.ts's "handleTaskUpdated" block.

    #[tokio::test(start_paused = true)]
    async fn handle_task_updated_ends_the_task_on_a_terminal_status() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.handle_task_started("chat-a", started_typed("u1", Some("local_agent")), ctx());
        te.handle_task_updated(
            "chat-a",
            TaskUpdatedPayload {
                task_id: "u1".to_string(),
                status: "completed".to_string(),
            },
        );
        assert_eq!(
            tracker.get("chat-a", "u1").unwrap().status,
            BackgroundTaskStatus::Completed
        );
    }

    #[tokio::test(start_paused = true)]
    async fn handle_task_updated_ignores_a_non_terminal_status() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.handle_task_started("chat-a", started_typed("u2", Some("local_agent")), ctx());
        te.handle_task_updated(
            "chat-a",
            TaskUpdatedPayload {
                task_id: "u2".to_string(),
                status: "running".to_string(),
            },
        );
        assert_eq!(
            tracker.get("chat-a", "u2").unwrap().status,
            BackgroundTaskStatus::Running
        );
    }

    #[tokio::test(start_paused = true)]
    async fn handle_task_updated_ignores_an_unknown_task_id() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.handle_task_updated(
            "chat-a",
            TaskUpdatedPayload {
                task_id: "ghost".to_string(),
                status: "completed".to_string(),
            },
        );
        assert!(tracker.get("chat-a", "ghost").is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn threads_deterministic_output_path_into_tracker_start() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let te = ClaudeTaskEvents::new(tracker.clone());
        te.handle_task_started(
            "chat-a",
            TaskStartedPayload {
                task_id: "tkid01".to_string(),
                tool_use_id: Some("tu1".to_string()),
                description: Some("d".to_string()),
                task_type: None,
            },
            ctx(),
        );
        let task = tracker.get("chat-a", "tkid01").unwrap();
        assert_eq!(task.id, "tkid01");
        let path = task.output_path.unwrap();
        assert!(path.contains("/claude"));
        assert!(path.ends_with("/-Users-x-proj/sess-uuid/tasks/tkid01.output"));
    }
}

// PORT STATUS: src/plugins/builtin/claude/task-events.ts (147 lines)
// confidence: high
// todos: 0
// notes: Main catch-up (#425): map_task_kind(task_type, has_bash_metadata) — prefix-
// notes: tolerant (contains bash/agent|teammate/workflow → kind, else Other; missing
// notes: task_type → Bash iff a Bash/Monitor tool_use was captured, else Other). The
// notes: TaskSeed now carries `kind` (added in mainframe-background-tasks::tracker,
// notes: cluster F — see blocker if that field is absent). handle_task_updated ends the
// notes: task ONLY on a terminal status (completed/failed/stopped guard mirrors the
// notes: KNOWN_STATUSES.has check), with empty output/summary + None usage; the tracker
// notes: dedups a prior notification. task-events.test.ts kind-mapping + handleTaskUpdated
// notes: blocks translated assertion-for-assertion.
// notes(orig): metadata + evictionTimers held behind one Arc<Mutex<Inner>> so the 60s
// notes: eviction sleep task can delete its own entry (CONCURRENCY.tsv 91-92
// notes: SINGLE_TASK; the shared inner is a session-local decoupling, not a
// notes: cross-session lock). spoolRoot() PathBuf is stringified for the same
// notes: `${spoolRoot()}/...` path. task-events.test.ts ported: the "threads
// notes: deterministic outputPath" spy assertion reads the real tracker's stored
// notes: output_path instead of spying tracker.start (same behavioral fact).
