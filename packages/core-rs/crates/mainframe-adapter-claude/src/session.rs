//! Ported from `packages/core/src/plugins/builtin/claude/session.ts`.
//!
//! Actor-model translation per CONCURRENCY.tsv rows 87-90:
//! - The NDJSON parse state (`ClaudeSessionState`) is SINGLE_TASK — owned behind
//!   one `Arc<Mutex<ClaudeSessionState>>` that only the stdout reader task and
//!   the `AdapterSession` methods touch. It is never held across a `.await`.
//! - The cross-task read surface (`pid`, `status`, `last_activity_ms`) is an
//!   `Arc<SharedSurface>` of atomics.
//! - The child process handle stays task-local (moved into the waiter task);
//!   kill/interrupt reach it via a cloneable `ChildHandle` (pid + a signaller
//!   seam + a close `Notify`), never by owning the `tokio::process::Child`.
//! - The control-channel `pending` map is the session-scoped leaf lock
//!   (`ControlRequestChannel`, session-control.rs).
//!
//! The spawn argv, stdin `control_request` envelopes, the user `sendMessage`
//! envelope, `respondToPermission` (incl. ExitPlanMode/AskUserQuestion
//! special-casing + localSettings promotion), SIGTERM→SIGKILL(3s), and
//! interrupt (protocol interrupt + per-task stop_task + 10s SIGINT fallback) are
//! copied verbatim from the TS source and its tests.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicI64, AtomicU8, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use nanoid::nanoid;
use serde_json::{Value, json};
use tokio::sync::{Notify, mpsc};

use mainframe_adapter_api::{
    AdapterError, AdapterSession, BoxFuture, ContextFiles, ImageInput, SessionSink,
    StopBackgroundTaskResult,
};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{
    AdapterProcess, AdapterProcessStatus, ControlBehavior, ControlDestination, ControlResponse,
    ControlUpdate, MessageUsage, SessionOptions, SessionSpawnOptions,
};
use mainframe_types::chat::{ChatMessage, ResolvedTuning};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::settings::ExecutionMode;

use crate::constants::MAINFRAME_SYSTEM_PROMPT_APPEND;
use crate::context_files::collect_claude_context_files;
use crate::events::{handle_stderr, handle_stdout};
use crate::pr_detection::DetectedPrCore;
use crate::session_control::{ControlRequestChannel, SendAwaitingOpts, StdinTx};
use crate::task_events::ClaudeTaskEvents;
use crate::tuning::tuning_to_flag_settings;

/// The `SessionSink` used when `spawn` is called without one — every callback is
/// a no-op (mirrors the TS `nullSink`).
pub struct NullSink;
impl SessionSink for NullSink {
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
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: mainframe_types::adapter::ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<mainframe_types::chat::TodoItem>) {}
    fn on_pr_detected(&self, _pr: mainframe_types::adapter::DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: mainframe_adapter_api::LoadedSkill) {}
    fn on_subagent_child(
        &self,
        _parent_tool_use_id: &str,
        _blocks: Vec<mainframe_types::chat::MessageContent>,
    ) {
    }
}

/// Signals delivered to the child via the signaller seam.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    Term,
    Kill,
    Int,
}

/// A task-local child handle: the kill/interrupt paths reach the process through
/// this (never by owning `tokio::process::Child`). `Clone` is cheap (all `Arc`).
#[derive(Clone)]
pub struct ChildHandle {
    pub pid: u32,
    signaller: Arc<dyn Fn(Signal) + Send + Sync>,
    closed: Arc<Notify>,
    exited: Arc<std::sync::atomic::AtomicBool>,
}

impl ChildHandle {
    fn signal(&self, sig: Signal) {
        (self.signaller)(sig);
    }
    fn exited(&self) -> bool {
        self.exited.load(Ordering::SeqCst)
    }
    /// Completes when the child emits `close` (the waiter task sets `exited` +
    /// `notify_waiters`). The `notified()` future is created before the `exited`
    /// check to avoid a lost wakeup.
    async fn wait_closed(&self) {
        loop {
            let n = self.closed.notified();
            if self.exited() {
                return;
            }
            n.await;
            if self.exited() {
                return;
            }
        }
    }
}

/// Production signaller: shell out to `kill -<SIG> <pid>` (house style — no
/// `libc`/`nix` in the allowlist; matches background-tasks::kill).
fn real_signaller(pid: u32) -> Arc<dyn Fn(Signal) + Send + Sync> {
    Arc::new(move |sig| {
        let flag = match sig {
            Signal::Term => "-TERM",
            Signal::Kill => "-KILL",
            Signal::Int => "-INT",
        };
        let pid_s = pid.to_string();
        tokio::spawn(async move {
            let _ = tokio::process::Command::new("kill")
                .arg(flag)
                .arg(pid_s)
                .status()
                .await;
        });
    })
}

/// A tracked in-flight CLI task (`activeTasks` value).
pub struct ActiveTask {
    pub task_type: String,
    pub command: Option<String>,
}

/// tool_use_id → originating tool name (+ Bash command). Gates Path-A PR scan.
pub struct ToolUseRegistryEntry {
    pub name: String,
    pub command: Option<String>,
}

/// Cross-task read surface (CONCURRENCY.tsv 88): atomics for pid/status/last-activity.
struct SharedSurface {
    pid: AtomicU32,
    status: AtomicU8,
    last_activity_ms: AtomicI64,
}

fn status_to_u8(s: AdapterProcessStatus) -> u8 {
    match s {
        AdapterProcessStatus::Starting => 0,
        AdapterProcessStatus::Ready => 1,
        AdapterProcessStatus::Running => 2,
        AdapterProcessStatus::Stopped => 3,
        AdapterProcessStatus::Error => 4,
    }
}
fn u8_to_status(v: u8) -> AdapterProcessStatus {
    match v {
        1 => AdapterProcessStatus::Ready,
        2 => AdapterProcessStatus::Running,
        3 => AdapterProcessStatus::Stopped,
        4 => AdapterProcessStatus::Error,
        _ => AdapterProcessStatus::Starting,
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Mutable NDJSON parse state — readable by events.rs and tests (CONCURRENCY.tsv
/// 87: SINGLE_TASK, owned behind one lock).
pub struct ClaudeSessionState {
    pub chat_id: String,
    pub mainframe_chat_id: String,
    pub real_project_path: String,
    pub buffer: String,
    pub last_assistant_usage: Option<MessageUsage>,
    pub child: Option<ChildHandle>,
    pub active_tasks: HashMap<String, ActiveTask>,
    pub interrupt_timer: Option<tokio::task::JoinHandle<()>>,
    pub pending_pr_creates: HashSet<String>,
    pub pending_pr_mutations: HashMap<String, DetectedPrCore>,
    pub tool_use_registry: HashMap<String, ToolUseRegistryEntry>,
    pub skill_path_cache: HashMap<String, String>,
    pub task_v2_events: Vec<Value>,
    pub task_events: ClaudeTaskEvents,
}

/// The CLI's permission_suggestions always use destination:"session". Promote
/// every session-scoped suggestion to localSettings (mirrors the terminal CLI's
/// "Always Allow"): the CLI then persists the rule AND updates in-memory state.
pub fn promote_to_local_settings(updates: Vec<ControlUpdate>) -> Vec<ControlUpdate> {
    updates.into_iter().map(promote_one).collect()
}

fn promote_one(u: ControlUpdate) -> ControlUpdate {
    let session = ControlDestination::Session;
    let local = ControlDestination::LocalSettings;
    match u {
        ControlUpdate::AddRules {
            rules,
            behavior,
            destination,
        } => ControlUpdate::AddRules {
            rules,
            behavior,
            destination: if destination == session {
                local
            } else {
                destination
            },
        },
        ControlUpdate::ReplaceRules {
            rules,
            behavior,
            destination,
        } => ControlUpdate::ReplaceRules {
            rules,
            behavior,
            destination: if destination == session {
                local
            } else {
                destination
            },
        },
        ControlUpdate::RemoveRules {
            rules,
            behavior,
            destination,
        } => ControlUpdate::RemoveRules {
            rules,
            behavior,
            destination: if destination == session {
                local
            } else {
                destination
            },
        },
        ControlUpdate::SetMode { mode, destination } => ControlUpdate::SetMode {
            mode,
            destination: if destination == session {
                local
            } else {
                destination
            },
        },
        ControlUpdate::AddDirectories {
            directories,
            destination,
        } => ControlUpdate::AddDirectories {
            directories,
            destination: if destination == session {
                local
            } else {
                destination
            },
        },
        ControlUpdate::RemoveDirectories {
            directories,
            destination,
        } => ControlUpdate::RemoveDirectories {
            directories,
            destination: if destination == session {
                local
            } else {
                destination
            },
        },
    }
}

/// set_model/apply_flag_settings/stop_task signal success/failure via the OUTER
/// `subtype`.
fn is_terminal_ctrl(raw: &Option<Value>) -> bool {
    raw.as_ref()
        .and_then(|v| v.get("subtype"))
        .and_then(Value::as_str)
        .map(|s| s == "success" || s == "error")
        .unwrap_or(false)
}
/// cancel_async_message's only real signal is the NESTED `response.cancelled`.
fn has_cancelled_flag(raw: &Option<Value>) -> bool {
    raw.as_ref()
        .and_then(|v| v.get("response"))
        .and_then(|r| r.get("cancelled"))
        .map(Value::is_boolean)
        .unwrap_or(false)
}

fn execution_mode_cli(mode: ExecutionMode) -> &'static str {
    match mode {
        ExecutionMode::Default => "default",
        ExecutionMode::AcceptEdits => "acceptEdits",
        ExecutionMode::Yolo => "bypassPermissions",
    }
}

/// Build the configured (unspawned) `claude` command. Extracted so the spawn-env
/// contract — notably the boot-resolved login-shell `PATH` — is unit-testable
/// without launching a real CLI.
fn build_spawn_command(
    executable: &str,
    args: &[String],
    project_path: &str,
    resolved_path: &str,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(executable);
    cmd.args(args)
        .current_dir(project_path)
        .env("PATH", resolved_path)
        .env("FORCE_COLOR", "0")
        .env("NO_COLOR", "1")
        // Unset CLAUDECODE so the child CLI doesn't refuse to start when the
        // daemon itself runs inside a Claude Code session.
        .env_remove("CLAUDECODE")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    cmd
}

/// Build the spawn argv (VERBATIM order) + the base (non-plan) permission mode.
/// Extracted so `session-spawn-args.test.ts` can assert on it directly.
fn build_args(options: &SessionSpawnOptions, resume: &Option<String>) -> (Vec<String>, String) {
    let mut args: Vec<String> = [
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--verbose",
        "--permission-prompt-tool",
        "stdio",
        // Make the CLI emit `isReplay: true` user events for every queued uuid.
        "--replay-user-messages",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    if options.system_prompt.as_deref() == Some("enabled") {
        args.push("--append-system-prompt".to_string());
        args.push(MAINFRAME_SYSTEM_PROMPT_APPEND.to_string());
    }

    if let Some(r) = resume {
        args.push("--resume".to_string());
        args.push(r.clone());
    }
    if let Some(m) = &options.model {
        args.push("--model".to_string());
        args.push(m.clone());
    }
    let base_mode = options
        .permission_mode
        .map(execution_mode_cli)
        .unwrap_or("default")
        .to_string();
    let cli_mode = if options.plan_mode == Some(true) {
        "plan".to_string()
    } else {
        base_mode.clone()
    };
    args.push("--permission-mode".to_string());
    args.push(cli_mode);
    args.push("--allow-dangerously-skip-permissions".to_string());
    (args, base_mode)
}

pub struct ClaudeSession {
    pub id: String,
    pub project_path: String,
    resume_session_id: Option<String>,
    on_exit: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
    pub control: Arc<ControlRequestChannel>,
    base_permission_mode: Mutex<String>,
    shared: Arc<SharedSurface>,
    pub(crate) state: Arc<Mutex<ClaudeSessionState>>,
    stdin_tx: Mutex<Option<StdinTx>>,
    weak_self: OnceLock<Weak<ClaudeSession>>,
    /// Boot-resolved login-shell `PATH`, applied to the spawned CLI (mirrors the
    /// TS `enrichPath` env mutation so packaged builds find `claude`).
    resolved_path: ResolvedPath,
}

impl ClaudeSession {
    pub fn new(
        options: SessionOptions,
        on_exit: Option<Box<dyn Fn() + Send + Sync>>,
        background_tasks: Arc<BackgroundTaskTracker>,
        resolved_path: ResolvedPath,
    ) -> Self {
        let id = nanoid!();
        let control = Arc::new(ControlRequestChannel::new(id.clone()));
        let chat_id = options.chat_id.clone().unwrap_or_default();
        ClaudeSession {
            id,
            project_path: options.project_path.clone(),
            resume_session_id: options.chat_id,
            on_exit: Mutex::new(on_exit),
            control,
            base_permission_mode: Mutex::new("default".to_string()),
            shared: Arc::new(SharedSurface {
                pid: AtomicU32::new(0),
                status: AtomicU8::new(status_to_u8(AdapterProcessStatus::Starting)),
                last_activity_ms: AtomicI64::new(now_ms()),
            }),
            state: Arc::new(Mutex::new(ClaudeSessionState {
                chat_id,
                mainframe_chat_id: options.mainframe_chat_id,
                real_project_path: options.project_path,
                buffer: String::new(),
                last_assistant_usage: None,
                child: None,
                active_tasks: HashMap::new(),
                interrupt_timer: None,
                pending_pr_creates: HashSet::new(),
                pending_pr_mutations: HashMap::new(),
                tool_use_registry: HashMap::new(),
                skill_path_cache: HashMap::new(),
                task_v2_events: Vec::new(),
                task_events: ClaudeTaskEvents::new(background_tasks),
            })),
            stdin_tx: Mutex::new(None),
            weak_self: OnceLock::new(),
            resolved_path,
        }
    }

    /// Store the `Weak<Self>` so `spawn`'s reader tasks can upgrade to an
    /// `Arc<ClaudeSession>`. Called once, right after `Arc::new`.
    pub fn init_weak(self: &Arc<Self>) {
        let _ = self.weak_self.set(Arc::downgrade(self));
    }

    /// Late-bind the exit callback (mirrors the TS `new ClaudeSession(opts, () =>
    /// this.sessions.delete(session))` — the closure needs the session's own id,
    /// which only exists after construction).
    pub fn set_on_exit(&self, cb: Box<dyn Fn() + Send + Sync>) {
        *self.on_exit.lock().unwrap_or_else(|e| e.into_inner()) = Some(cb);
    }

    fn state(&self) -> std::sync::MutexGuard<'_, ClaudeSessionState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn stdin_clone(&self) -> Option<StdinTx> {
        self.stdin_tx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// stdin available for a write (present AND the writer task is alive) —
    /// mirrors the TS `!stdin || stdin.destroyed` guard (`is_closed` ≈ destroyed).
    fn available_stdin(&self) -> Option<StdinTx> {
        match self.stdin_clone() {
            Some(tx) if !tx.is_closed() => Some(tx),
            _ => None,
        }
    }

    pub(crate) fn bump_last_activity(&self) {
        self.shared
            .last_activity_ms
            .store(now_ms(), Ordering::SeqCst);
    }

    pub(crate) fn set_status(&self, s: AdapterProcessStatus) {
        self.shared.status.store(status_to_u8(s), Ordering::SeqCst);
    }

    pub fn is_spawned(&self) -> bool {
        self.state().child.is_some()
    }

    pub fn last_activity_at(&self) -> i64 {
        self.shared.last_activity_ms.load(Ordering::SeqCst)
    }

    pub fn get_process_info(&self) -> Option<AdapterProcess> {
        let st = self.state();
        st.child.as_ref()?;
        Some(AdapterProcess {
            id: self.id.clone(),
            adapter_id: "claude".to_string(),
            chat_id: st.chat_id.clone(),
            pid: self.shared.pid.load(Ordering::SeqCst) as i64,
            status: u8_to_status(self.shared.status.load(Ordering::SeqCst)),
            project_path: self.project_path.clone(),
            model: None,
        })
    }

    // --- test seams (mirror TS `session.state.child = ...` injection) ---
    #[cfg(test)]
    pub(crate) fn set_child_for_test(&self, child: ChildHandle) {
        self.state().child = Some(child);
    }
    #[cfg(test)]
    pub(crate) fn set_stdin_for_test(&self, tx: Option<StdinTx>) {
        *self.stdin_tx.lock().unwrap() = tx;
    }
    #[cfg(test)]
    pub(crate) fn chat_id(&self) -> String {
        self.state().chat_id.clone()
    }
    #[cfg(test)]
    pub(crate) fn mainframe_chat_id(&self) -> String {
        self.state().mainframe_chat_id.clone()
    }

    pub async fn spawn(
        &self,
        options: SessionSpawnOptions,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> Result<AdapterProcess, AdapterError> {
        let active_sink: Arc<dyn SessionSink> = sink.unwrap_or_else(|| Arc::new(NullSink));

        let (args, base_mode) = build_args(&options, &self.resume_session_id);
        *self
            .base_permission_mode
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = base_mode;

        let executable = options
            .executable_path
            .clone()
            .unwrap_or_else(|| "claude".to_string());

        let real = tokio::fs::canonicalize(&self.project_path)
            .await
            .map_err(|_| {
                AdapterError::Message(format!(
                    "Project directory does not exist or is not accessible: {}",
                    self.project_path
                ))
            })?;
        self.state().real_project_path = real.to_string_lossy().to_string();

        let mut child = build_spawn_command(
            &executable,
            &args,
            &self.project_path,
            self.resolved_path.as_str(),
        )
        .spawn()?;

        let pid = child.id().unwrap_or(0);
        let closed = Arc::new(Notify::new());
        let exited = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let handle = ChildHandle {
            pid,
            signaller: real_signaller(pid),
            closed: closed.clone(),
            exited: exited.clone(),
        };
        self.state().child = Some(handle);
        self.shared.pid.store(pid, Ordering::SeqCst);
        self.set_status(AdapterProcessStatus::Starting);
        self.bump_last_activity();

        // stdin writer task fed by an mpsc (the StdinTx).
        let child_stdin = child.stdin.take();
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        if let Some(mut stdin) = child_stdin {
            tokio::spawn(async move {
                use tokio::io::AsyncWriteExt;
                while let Some(bytes) = stdin_rx.recv().await {
                    if stdin.write_all(&bytes).await.is_err() {
                        break;
                    }
                    let _ = stdin.flush().await;
                }
            });
        }
        *self.stdin_tx.lock().unwrap_or_else(|e| e.into_inner()) = Some(stdin_tx);

        if let Some(tuning) = &options.tuning {
            let settings = tuning_to_flag_settings(tuning);
            if !settings.is_empty() {
                self.control.send(
                    self.stdin_clone().as_ref(),
                    &json!({ "subtype": "apply_flag_settings", "settings": settings }),
                );
            }
        }

        tracing::debug!(
            session_id = %self.id,
            project_path = %self.project_path,
            resume = self.resume_session_id.is_some(),
            model = options.model.as_deref().unwrap_or("default"),
            permission_mode = ?options.permission_mode,
            "claude session spawned"
        );

        let weak = self.weak_self.get().cloned();

        // stdout reader → handle_stdout
        if let Some(mut stdout) = child.stdout.take() {
            let weak = weak.clone();
            let sink = active_sink.clone();
            tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let mut buf = [0u8; 8192];
                loop {
                    match stdout.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            if let Some(session) = weak.as_ref().and_then(Weak::upgrade) {
                                handle_stdout(&session, &buf[..n], &*sink);
                            } else {
                                break;
                            }
                        }
                    }
                }
            });
        }

        // stderr reader → handle_stderr
        if let Some(mut stderr) = child.stderr.take() {
            let weak = weak.clone();
            let sink = active_sink.clone();
            tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let mut buf = [0u8; 8192];
                loop {
                    match stderr.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            if let Some(session) = weak.as_ref().and_then(Weak::upgrade) {
                                handle_stderr(&session, &buf[..n], &*sink);
                            } else {
                                break;
                            }
                        }
                    }
                }
            });
        }

        // waiter → `close` handler (drain control, onExit, onExit callback).
        {
            let weak = weak.clone();
            let control = self.control.clone();
            let sink = active_sink.clone();
            tokio::spawn(async move {
                let status = child.wait().await;
                let code = status.ok().and_then(|s| s.code());
                exited.store(true, Ordering::SeqCst);
                if let Some(session) = weak.as_ref().and_then(Weak::upgrade) {
                    session.state().child = None;
                    *session.stdin_tx.lock().unwrap_or_else(|e| e.into_inner()) = None;
                }
                control.drain_all_as_failed();
                closed.notify_waiters();
                sink.on_exit(code);
                if let Some(session) = weak.as_ref().and_then(Weak::upgrade) {
                    let guard = session.on_exit.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(cb) = guard.as_ref() {
                        cb();
                    }
                }
            });
        }

        self.get_process_info()
            .ok_or_else(|| AdapterError::Message("spawn produced no process info".to_string()))
    }

    pub async fn kill(&self) -> Result<(), AdapterError> {
        let child = self.state().child.clone();
        let Some(child) = child else { return Ok(()) };

        child.signal(Signal::Term);
        tokio::select! {
            _ = child.wait_closed() => {}
            _ = tokio::time::sleep(Duration::from_millis(3000)) => {
                if !child.exited() {
                    child.signal(Signal::Kill);
                }
            }
        }
        self.state().child = None;
        self.control.drain_all_as_failed();
        tracing::debug!(session_id = %self.id, "claude session killed");
        Ok(())
    }

    pub async fn interrupt(&self) -> Result<(), AdapterError> {
        let child = self.state().child.clone();
        let Some(child) = child else { return Ok(()) };

        let stdin = self.stdin_clone();
        // Interrupt the main turn first so the abort fires before subtask results
        // propagate back to the main agent.
        self.control
            .send(stdin.as_ref(), &json!({ "subtype": "interrupt" }));

        // Then stop subtasks to clean them up.
        let task_ids: Vec<String> = { self.state().active_tasks.keys().cloned().collect() };
        for task_id in &task_ids {
            self.control.send(
                stdin.as_ref(),
                &json!({ "subtype": "stop_task", "task_id": task_id }),
            );
        }
        self.state().active_tasks.clear();

        // Fallback: if the protocol interrupt doesn't take effect within 10s,
        // send SIGINT as a last resort. Cancelled by clear_interrupt_timer() when
        // a result event arrives.
        let state = self.state.clone();
        let child_for_timer = child.clone();
        let session_id = self.id.clone();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10_000)).await;
            let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
            st.interrupt_timer = None;
            let same = st
                .child
                .as_ref()
                .map(|c| Arc::ptr_eq(&c.exited, &child_for_timer.exited))
                .unwrap_or(false);
            if same && !child_for_timer.exited() {
                tracing::warn!(
                    session_id = %session_id,
                    "protocol interrupt timed out, sending SIGINT fallback"
                );
                child_for_timer.signal(Signal::Int);
            }
        });
        self.state().interrupt_timer = Some(handle);
        Ok(())
    }

    /// Cancel the SIGINT fallback — called when a result event confirms the turn
    /// ended.
    pub fn clear_interrupt_timer(&self) {
        if let Some(h) = self.state().interrupt_timer.take() {
            h.abort();
        }
    }

    pub fn request_context_usage(&self) {
        if self.state().child.is_none() {
            return;
        }
        let stdin = self.stdin_clone();
        self.control
            .send(stdin.as_ref(), &json!({ "subtype": "get_context_usage" }));
    }

    pub async fn set_permission_mode(&self, mode: ExecutionMode) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        let cli_mode = execution_mode_cli(mode).to_string();
        // Track non-plan modes so set_plan_mode(false) can restore whatever the
        // user last picked.
        *self
            .base_permission_mode
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = cli_mode.clone();
        self.write_cli_permission_mode(&cli_mode);
        Ok(())
    }

    pub async fn set_plan_mode(&self, on: bool) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        let mode = if on {
            "plan".to_string()
        } else {
            self.base_permission_mode
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        };
        self.write_cli_permission_mode(&mode);
        Ok(())
    }

    fn write_cli_permission_mode(&self, cli_mode: &str) {
        let stdin = self.stdin_clone();
        self.control.send(
            stdin.as_ref(),
            &json!({ "subtype": "set_permission_mode", "mode": cli_mode }),
        );
    }

    async fn await_terminal(&self, request: Value, label: &str) -> Option<Value> {
        let stdin = self.stdin_clone();
        self.control
            .send_awaiting(
                stdin.as_ref(),
                &request,
                SendAwaitingOpts {
                    label: label.to_string(),
                    timeout_ms: None,
                    is_terminal: Some(Box::new(is_terminal_ctrl)),
                },
            )
            .await
    }

    async fn require_success(&self, request: Value, subtype: &str) -> Result<(), AdapterError> {
        let raw = self.await_terminal(request, subtype).await;
        if raw
            .as_ref()
            .and_then(|v| v.get("subtype"))
            .and_then(Value::as_str)
            == Some("success")
        {
            return Ok(());
        }
        let err = raw
            .as_ref()
            .and_then(|v| v.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("timeout");
        Err(AdapterError::Message(format!("{subtype} failed: {err}")))
    }

    pub async fn set_model(&self, model: String) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        self.require_success(
            json!({ "subtype": "set_model", "model": model }),
            "set_model",
        )
        .await
    }

    pub async fn apply_tuning(&self, tuning: ResolvedTuning) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        self.require_success(
            json!({ "subtype": "apply_flag_settings", "settings": tuning_to_flag_settings(&tuning) }),
            "apply_flag_settings",
        )
        .await
    }

    fn write_stdin(&self, line: String) {
        if let Some(tx) = self.stdin_clone() {
            let mut bytes = line.into_bytes();
            bytes.push(b'\n');
            let _ = tx.send(bytes);
        }
        self.bump_last_activity();
    }

    pub async fn send_command(&self, command: String, args: String) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        let chat_id = self.state().chat_id.clone();
        let text = format!(
            "<command-name>/{command}</command-name>\n<command-message>{command}</command-message>\n<command-args>{args}</command-args>"
        );
        let payload = json!({
            "type": "user",
            "session_id": chat_id,
            "message": { "role": "user", "content": [{ "type": "text", "text": text }] },
            "parent_tool_use_id": null,
        });
        self.write_stdin(payload.to_string());
        Ok(())
    }

    pub async fn send_message(
        &self,
        message: String,
        images: Vec<ImageInput>,
        uuid: Option<String>,
    ) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        let chat_id = self.state().chat_id.clone();
        let mut content: Vec<Value> = Vec::new();
        for img in &images {
            content.push(json!({
                "type": "image",
                "source": { "type": "base64", "media_type": img.media_type, "data": img.data },
            }));
        }
        if !message.is_empty() || content.is_empty() {
            content.push(json!({ "type": "text", "text": message }));
        }
        let mut payload = json!({
            "type": "user",
            "session_id": chat_id,
            "message": { "role": "user", "content": content },
            "parent_tool_use_id": null,
        });
        if let Some(u) = uuid {
            payload["uuid"] = Value::String(u);
        }
        self.write_stdin(payload.to_string());
        Ok(())
    }

    pub async fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> Result<(), AdapterError> {
        let behavior_str = if response.behavior == ControlBehavior::Allow {
            "allow"
        } else {
            "deny"
        };
        let mut inner = json!({
            "behavior": behavior_str,
            "toolUseID": response.tool_use_id,
        });

        let tool_name = response.tool_name.as_deref();
        if response.behavior == ControlBehavior::Allow {
            if let Some(ui) = &response.updated_input {
                inner["updatedInput"] = serde_json::to_value(ui).unwrap_or(Value::Null);
            }
            if let Some(up) = response.updated_permissions.clone() {
                inner["updatedPermissions"] =
                    serde_json::to_value(promote_to_local_settings(up)).unwrap_or(Value::Null);
            }
        } else {
            if tool_name == Some("ExitPlanMode") {
                let preamble = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).";
                let msg = match &response.message {
                    Some(m) => {
                        format!("{preamble} To tell you how to proceed, the user said:\n{m}")
                    }
                    None => format!(
                        "{preamble} The user rejected the plan. Stay in plan mode and wait for new instructions from the user."
                    ),
                };
                inner["message"] = Value::String(msg);
            } else {
                let msg = response.message.clone().unwrap_or_else(|| {
                    if tool_name == Some("AskUserQuestion") {
                        "User skipped the question".to_string()
                    } else {
                        "User denied permission".to_string()
                    }
                });
                inner["message"] = Value::String(msg);
            }
            if tool_name != Some("AskUserQuestion") && tool_name != Some("ExitPlanMode") {
                inner["interrupt"] = Value::Bool(true);
            }
        }

        let payload = json!({
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": response.request_id,
                "response": inner,
            },
        });
        let json_str = payload.to_string();

        let Some(tx) = self.available_stdin() else {
            tracing::error!(
                session_id = %self.id,
                request_id = %response.request_id,
                tool_name = ?response.tool_name,
                "respondToPermission: stdin unavailable, response dropped"
            );
            return Ok(());
        };
        tracing::info!(
            session_id = %self.id,
            request_id = %response.request_id,
            tool_name = ?response.tool_name,
            behavior = %behavior_str,
            payload = %json_str,
            "writing permission response to stdin"
        );
        let mut bytes = json_str.into_bytes();
        bytes.push(b'\n');
        let _ = tx.send(bytes);
        Ok(())
    }

    /// The cancelled boolean lives nested at `response.response.cancelled`.
    pub async fn cancel_queued_message(&self, uuid: String) -> Result<bool, AdapterError> {
        let Some(tx) = self.available_stdin() else {
            tracing::warn!(session_id = %self.id, uuid = %uuid, "cancelQueuedMessage: stdin unavailable");
            return Ok(false);
        };
        let raw = self
            .control
            .send_awaiting(
                Some(&tx),
                &json!({ "subtype": "cancel_async_message", "message_uuid": uuid }),
                SendAwaitingOpts {
                    label: "cancel_async_message".to_string(),
                    timeout_ms: None,
                    is_terminal: Some(Box::new(has_cancelled_flag)),
                },
            )
            .await;
        Ok(raw
            .as_ref()
            .and_then(|v| v.get("response"))
            .and_then(|r| r.get("cancelled"))
            .and_then(Value::as_bool)
            .unwrap_or(false))
    }

    /// stop_task's nested `response.response` is always `{}`; the outer envelope's
    /// `subtype` is the only success/failure signal.
    pub async fn stop_background_task(
        &self,
        task_id: String,
    ) -> Result<StopBackgroundTaskResult, AdapterError> {
        let Some(tx) = self.available_stdin() else {
            tracing::warn!(session_id = %self.id, task_id = %task_id, "stopBackgroundTask: stdin unavailable");
            return Ok(StopBackgroundTaskResult {
                ok: false,
                error: Some("stdin unavailable".to_string()),
            });
        };
        let raw = self
            .control
            .send_awaiting(
                Some(&tx),
                &json!({ "subtype": "stop_task", "task_id": task_id }),
                SendAwaitingOpts {
                    label: "stop_task".to_string(),
                    timeout_ms: None,
                    is_terminal: Some(Box::new(is_terminal_ctrl)),
                },
            )
            .await;
        if raw
            .as_ref()
            .and_then(|v| v.get("subtype"))
            .and_then(Value::as_str)
            == Some("success")
        {
            return Ok(StopBackgroundTaskResult {
                ok: true,
                error: None,
            });
        }
        let err = raw
            .as_ref()
            .and_then(|v| v.get("error"))
            .or_else(|| {
                raw.as_ref()
                    .and_then(|v| v.get("response"))
                    .and_then(|r| r.get("error"))
            })
            .and_then(Value::as_str)
            .unwrap_or("timeout")
            .to_string();
        Ok(StopBackgroundTaskResult {
            ok: false,
            error: Some(err),
        })
    }

    pub fn get_context_files(&self) -> ContextFiles {
        collect_claude_context_files(&self.project_path, None)
    }

    pub async fn load_history(&self) -> Result<Vec<ChatMessage>, AdapterError> {
        let Some(resume) = &self.resume_session_id else {
            return Ok(vec![]);
        };
        Ok(crate::history::load_history(resume, &self.project_path).await)
    }

    pub async fn extract_plan_files(&self) -> Result<Vec<String>, AdapterError> {
        let Some(resume) = &self.resume_session_id else {
            return Ok(vec![]);
        };
        Ok(crate::history::extract_plan_file_paths(resume, &self.project_path).await)
    }

    pub async fn extract_skill_files(&self) -> Result<Vec<SkillFileEntry>, AdapterError> {
        let Some(resume) = &self.resume_session_id else {
            return Ok(vec![]);
        };
        Ok(crate::history::extract_skill_file_paths(resume, &self.project_path).await)
    }
}

impl AdapterSession for ClaudeSession {
    fn id(&self) -> &str {
        &self.id
    }
    fn adapter_id(&self) -> &str {
        "claude"
    }
    fn project_path(&self) -> &str {
        &self.project_path
    }
    fn is_spawned(&self) -> bool {
        ClaudeSession::is_spawned(self)
    }
    fn supports_replay_ack(&self) -> bool {
        true
    }
    fn last_activity_at(&self) -> Option<i64> {
        Some(ClaudeSession::last_activity_at(self))
    }
    fn spawn(
        &self,
        options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        let options = options.unwrap_or(SessionSpawnOptions {
            model: None,
            permission_mode: None,
            plan_mode: None,
            executable_path: None,
            system_prompt: None,
            tuning: None,
        });
        Box::pin(ClaudeSession::spawn(self, options, sink))
    }
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::kill(self))
    }
    fn get_process_info(&self) -> Option<AdapterProcess> {
        ClaudeSession::get_process_info(self)
    }
    fn send_message(
        &self,
        message: String,
        images: Vec<ImageInput>,
        uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::send_message(self, message, images, uuid))
    }
    fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::respond_to_permission(self, response))
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::interrupt(self))
    }
    fn set_model(&self, model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::set_model(self, model))
    }
    fn set_permission_mode(&self, mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::set_permission_mode(self, mode))
    }
    fn set_plan_mode(&self, on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::set_plan_mode(self, on))
    }
    fn send_command(
        &self,
        command: String,
        args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::send_command(
            self,
            command,
            args.unwrap_or_default(),
        ))
    }
    fn cancel_queued_message(&self, uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(ClaudeSession::cancel_queued_message(self, uuid))
    }
    fn get_context_files(&self) -> ContextFiles {
        ClaudeSession::get_context_files(self)
    }
    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin(ClaudeSession::load_history(self))
    }
    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>> {
        Box::pin(ClaudeSession::extract_plan_files(self))
    }
    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>> {
        Box::pin(ClaudeSession::extract_skill_files(self))
    }
    fn stop_background_task(
        &self,
        task_id: String,
    ) -> BoxFuture<'_, Result<StopBackgroundTaskResult, AdapterError>> {
        Box::pin(ClaudeSession::stop_background_task(self, task_id))
    }
    fn apply_tuning(&self, tuning: ResolvedTuning) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(ClaudeSession::apply_tuning(self, tuning))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The boot-resolved login-shell PATH must land in the spawned `claude`
    /// command's env (the Phase-5 blocker: packaged apps otherwise ENOENT).
    #[test]
    fn spawn_command_carries_the_resolved_path() {
        let cmd = build_spawn_command(
            "claude",
            &["--version".to_string()],
            "/tmp",
            "/opt/homebrew/bin:/usr/bin",
        );
        let path = cmd
            .as_std()
            .get_envs()
            .find(|(k, _)| *k == std::ffi::OsStr::new("PATH"))
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().into_owned());
        assert_eq!(path.as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
    }

    fn session() -> Arc<ClaudeSession> {
        let s = Arc::new(ClaudeSession::new(
            SessionOptions {
                project_path: "/tmp".to_string(),
                chat_id: None,
                mainframe_chat_id: "test-chat-id".to_string(),
            },
            None,
            Arc::new(BackgroundTaskTracker::new()),
            ResolvedPath::from_value("/usr/bin:/bin"),
        ));
        s.init_weak();
        s
    }

    fn spawn_opts(permission_mode: Option<ExecutionMode>) -> SessionSpawnOptions {
        SessionSpawnOptions {
            model: None,
            permission_mode,
            plan_mode: None,
            executable_path: None,
            system_prompt: None,
            tuning: None,
        }
    }

    fn mode_arg(args: &[String]) -> &str {
        let i = args.iter().position(|a| a == "--permission-mode").unwrap();
        &args[i + 1]
    }

    // --- session-spawn-args.test.ts ---
    #[test]
    fn default_mode_passes_permission_mode_default() {
        let (args, _) = build_args(&spawn_opts(Some(ExecutionMode::Default)), &None);
        assert_eq!(mode_arg(&args), "default");
        assert!(
            args.iter()
                .any(|a| a == "--allow-dangerously-skip-permissions")
        );
        assert!(!args.iter().any(|a| a == "--dangerously-skip-permissions"));
    }

    #[test]
    fn plan_mode_passes_permission_mode_plan() {
        let mut o = spawn_opts(Some(ExecutionMode::Default));
        o.plan_mode = Some(true);
        let (args, _) = build_args(&o, &None);
        assert_eq!(mode_arg(&args), "plan");
        assert!(
            args.iter()
                .any(|a| a == "--allow-dangerously-skip-permissions")
        );
    }

    #[test]
    fn accept_edits_mode_passes_permission_mode_accept_edits() {
        let (args, _) = build_args(&spawn_opts(Some(ExecutionMode::AcceptEdits)), &None);
        assert_eq!(mode_arg(&args), "acceptEdits");
    }

    #[test]
    fn yolo_mode_passes_permission_mode_bypass_permissions() {
        let (args, _) = build_args(&spawn_opts(Some(ExecutionMode::Yolo)), &None);
        assert_eq!(mode_arg(&args), "bypassPermissions");
    }

    #[test]
    fn undefined_permission_mode_defaults_to_default() {
        let (args, _) = build_args(&spawn_opts(None), &None);
        assert_eq!(mode_arg(&args), "default");
        assert!(
            args.iter()
                .any(|a| a == "--allow-dangerously-skip-permissions")
        );
    }

    #[test]
    fn omits_append_system_prompt_by_default() {
        let (args, _) = build_args(&spawn_opts(None), &None);
        assert!(!args.iter().any(|a| a == "--append-system-prompt"));
    }

    #[test]
    fn includes_append_system_prompt_when_enabled() {
        let mut o = spawn_opts(None);
        o.system_prompt = Some("enabled".to_string());
        let (args, _) = build_args(&o, &None);
        let i = args
            .iter()
            .position(|a| a == "--append-system-prompt")
            .unwrap();
        assert_eq!(args[i + 1], MAINFRAME_SYSTEM_PROMPT_APPEND);
    }

    #[test]
    fn does_not_pass_effort_but_passes_model() {
        let mut o = spawn_opts(None);
        o.model = Some("opus".to_string());
        o.tuning = Some(ResolvedTuning {
            effort: Some(mainframe_types::adapter::EffortLevel::High),
            fast: false,
            ultracode: false,
            adaptive_thinking: false,
        });
        let (args, _) = build_args(&o, &None);
        assert!(!args.iter().any(|a| a == "--effort"));
        assert!(args.iter().any(|a| a == "--model"));
    }

    // --- control-requests.test.ts (ClaudeAdapter control requests block) ---
    fn dummy_child() -> ChildHandle {
        ChildHandle {
            pid: 12345,
            signaller: Arc::new(|_| {}),
            closed: Arc::new(Notify::new()),
            exited: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Inject a child + a capturable stdin, returning the receiver of writes.
    fn spawned_with_stdin(s: &ClaudeSession) -> mpsc::UnboundedReceiver<Vec<u8>> {
        s.set_child_for_test(dummy_child());
        let (tx, rx) = mpsc::unbounded_channel();
        s.set_stdin_for_test(Some(tx));
        rx
    }

    fn read_json(rx: &mut mpsc::UnboundedReceiver<Vec<u8>>) -> Value {
        let bytes = rx.try_recv().expect("a write was captured");
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn set_permission_mode_sends_control_request_payload() {
        let s = session();
        let mut rx = spawned_with_stdin(&s);
        s.set_permission_mode(ExecutionMode::Default).await.unwrap();
        let payload = read_json(&mut rx);
        assert_eq!(payload["type"], "control_request");
        assert!(payload["request_id"].as_str().is_some());
        assert_eq!(payload["request"]["subtype"], "set_permission_mode");
        assert_eq!(payload["request"]["mode"], "default");
    }

    #[tokio::test]
    async fn set_permission_mode_maps_yolo_to_bypass_permissions() {
        let s = session();
        let mut rx = spawned_with_stdin(&s);
        s.set_permission_mode(ExecutionMode::Yolo).await.unwrap();
        assert_eq!(read_json(&mut rx)["request"]["mode"], "bypassPermissions");
    }

    #[tokio::test]
    async fn set_plan_mode_true_sends_plan() {
        let s = session();
        let mut rx = spawned_with_stdin(&s);
        s.set_plan_mode(true).await.unwrap();
        assert_eq!(read_json(&mut rx)["request"]["mode"], "plan");
    }

    #[tokio::test]
    async fn set_model_sends_control_request_and_awaits_success() {
        let s = session();
        let mut rx = spawned_with_stdin(&s);
        let s2 = s.clone();
        let pending =
            tokio::spawn(
                async move { s2.set_model("claude-sonnet-4-5-20250929".to_string()).await },
            );
        // Wait for the write, then resolve the awaiter.
        let payload = loop {
            tokio::task::yield_now().await;
            if let Ok(bytes) = rx.try_recv() {
                break serde_json::from_slice::<Value>(&bytes).unwrap();
            }
        };
        let request_id = payload["request_id"].as_str().unwrap();
        assert_eq!(payload["request"]["subtype"], "set_model");
        assert_eq!(payload["request"]["model"], "claude-sonnet-4-5-20250929");
        assert!(s.control.resolve(
            request_id,
            Some(json!({ "request_id": request_id, "subtype": "success" }))
        ));
        pending.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn set_permission_mode_throws_when_not_spawned() {
        let s = session();
        let err = s
            .set_permission_mode(ExecutionMode::Default)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("not spawned"));
    }

    #[tokio::test]
    async fn set_model_throws_when_not_spawned() {
        let s = session();
        let err = s
            .set_model("claude-opus-4-6".to_string())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("not spawned"));
    }

    #[tokio::test]
    async fn each_control_request_has_a_unique_request_id() {
        let s = session();
        let mut rx = spawned_with_stdin(&s);
        s.set_permission_mode(ExecutionMode::Default).await.unwrap();
        let id1 = read_json(&mut rx)["request_id"]
            .as_str()
            .unwrap()
            .to_string();
        let s2 = s.clone();
        let pending =
            tokio::spawn(async move { s2.set_model("claude-opus-4-6".to_string()).await });
        let payload = loop {
            tokio::task::yield_now().await;
            if let Ok(bytes) = rx.try_recv() {
                break serde_json::from_slice::<Value>(&bytes).unwrap();
            }
        };
        let id2 = payload["request_id"].as_str().unwrap().to_string();
        assert!(s.control.resolve(
            &id2,
            Some(json!({ "request_id": id2, "subtype": "success" }))
        ));
        pending.await.unwrap().unwrap();
        assert_ne!(id1, id2);
    }

    // --- kill-awaits-close.test.ts ---
    struct TestChild {
        exited: Arc<std::sync::atomic::AtomicBool>,
        closed: Arc<Notify>,
        signals: Arc<Mutex<Vec<Signal>>>,
    }
    impl TestChild {
        fn trigger_close(&self) {
            self.exited.store(true, Ordering::SeqCst);
            self.closed.notify_waiters();
        }
    }
    fn test_child() -> (ChildHandle, TestChild) {
        let exited = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let closed = Arc::new(Notify::new());
        let signals = Arc::new(Mutex::new(Vec::new()));
        let sig = signals.clone();
        let child = ChildHandle {
            pid: 99999,
            signaller: Arc::new(move |s| sig.lock().unwrap().push(s)),
            closed: closed.clone(),
            exited: exited.clone(),
        };
        (
            child,
            TestChild {
                exited,
                closed,
                signals,
            },
        )
    }

    #[tokio::test]
    async fn kill_resolves_only_after_child_emits_close() {
        let s = session();
        let (child, ctrl) = test_child();
        s.set_child_for_test(child);
        let s2 = s.clone();
        let mut fut = Box::pin(async move { s2.kill().await });

        tokio::select! {
            _ = &mut fut => panic!("kill resolved before close"),
            _ = tokio::time::sleep(Duration::from_millis(30)) => {}
        }
        assert!(ctrl.signals.lock().unwrap().contains(&Signal::Term));

        ctrl.trigger_close();
        tokio::time::timeout(Duration::from_secs(1), fut)
            .await
            .expect("kill resolves after close")
            .unwrap();
        assert!(s.state().child.is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn kill_falls_back_to_sigkill_after_3s() {
        let s = session();
        let (child, ctrl) = test_child();
        s.set_child_for_test(child);
        let s2 = s.clone();
        let handle = tokio::spawn(async move { s2.kill().await });
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_millis(3000)).await;
        tokio::task::yield_now().await;
        handle.await.unwrap().unwrap();
        let signals = ctrl.signals.lock().unwrap();
        assert!(signals.contains(&Signal::Term));
        assert!(signals.contains(&Signal::Kill));
    }

    // --- stop-background-task.test.ts ---
    #[tokio::test]
    async fn stop_background_task_returns_unavailable_when_no_stdin() {
        let s = session();
        s.set_child_for_test(dummy_child());
        // no stdin injected
        let r = s.stop_background_task("task-1".to_string()).await.unwrap();
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("stdin unavailable"));
    }

    #[tokio::test]
    async fn stop_background_task_returns_unavailable_when_stdin_destroyed() {
        let s = session();
        s.set_child_for_test(dummy_child());
        let (tx, rx) = mpsc::unbounded_channel();
        drop(rx); // receiver gone => tx.is_closed() == destroyed
        s.set_stdin_for_test(Some(tx));
        let r = s.stop_background_task("task-2".to_string()).await.unwrap();
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("stdin unavailable"));
    }

    #[tokio::test(start_paused = true)]
    async fn stop_background_task_times_out_after_5s() {
        let s = session();
        let mut _rx = spawned_with_stdin(&s);
        let s2 = s.clone();
        let handle =
            tokio::spawn(async move { s2.stop_background_task("task-3".to_string()).await });
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_millis(5001)).await;
        let r = handle.await.unwrap().unwrap();
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("timeout"));
    }

    #[tokio::test]
    async fn stop_background_task_ok_on_success_envelope() {
        let s = session();
        let mut rx = spawned_with_stdin(&s);
        let s2 = s.clone();
        let pending =
            tokio::spawn(async move { s2.stop_background_task("task-4".to_string()).await });
        let payload = loop {
            tokio::task::yield_now().await;
            if let Ok(bytes) = rx.try_recv() {
                break serde_json::from_slice::<Value>(&bytes).unwrap();
            }
        };
        let request_id = payload["request_id"].as_str().unwrap();
        assert!(s.control.resolve(
            request_id,
            Some(json!({ "request_id": request_id, "subtype": "success", "response": {} }))
        ));
        assert_eq!(
            pending.await.unwrap().unwrap(),
            StopBackgroundTaskResult {
                ok: true,
                error: None
            }
        );
    }

    #[tokio::test]
    async fn stop_background_task_error_on_error_envelope() {
        let s = session();
        let mut rx = spawned_with_stdin(&s);
        let s2 = s.clone();
        let pending =
            tokio::spawn(async move { s2.stop_background_task("task-4b".to_string()).await });
        let payload = loop {
            tokio::task::yield_now().await;
            if let Ok(bytes) = rx.try_recv() {
                break serde_json::from_slice::<Value>(&bytes).unwrap();
            }
        };
        let request_id = payload["request_id"].as_str().unwrap();
        s.control.resolve(
            request_id,
            Some(json!({ "request_id": request_id, "subtype": "error", "error": "no such task" })),
        );
        assert_eq!(
            pending.await.unwrap().unwrap(),
            StopBackgroundTaskResult {
                ok: false,
                error: Some("no such task".to_string())
            }
        );
    }

    #[tokio::test]
    async fn stop_background_task_writes_stop_task_control_request() {
        let s = session();
        let mut rx = spawned_with_stdin(&s);
        let s2 = s.clone();
        let pending =
            tokio::spawn(async move { s2.stop_background_task("task-5".to_string()).await });
        let payload = loop {
            tokio::task::yield_now().await;
            if let Ok(bytes) = rx.try_recv() {
                break serde_json::from_slice::<Value>(&bytes).unwrap();
            }
        };
        assert_eq!(payload["type"], "control_request");
        assert_eq!(payload["request"]["subtype"], "stop_task");
        assert_eq!(payload["request"]["task_id"], "task-5");
        let request_id = payload["request_id"].as_str().unwrap();
        s.control.resolve(
            request_id,
            Some(json!({ "request_id": request_id, "subtype": "success", "response": {} })),
        );
        pending.await.unwrap().unwrap();
    }
}

// PORT STATUS: src/plugins/builtin/claude/session.ts (512 lines)
// confidence: medium
// todos: 0
// notes: Main catch-up (#432): get_context_files now delegates to
// notes: collect_claude_context_files (context_files.rs) — global files carry their
// notes: absolute ~/.claude path; the old inline body + ContextFile/ContextFileSource
// notes: imports removed.
// notes: Actor-model translation per CONCURRENCY.tsv 87-90: parse state is one
// notes: Arc<Mutex<ClaudeSessionState>> (SINGLE_TASK, never held across .await);
// notes: pid/status/last_activity_ms are the Arc<SharedSurface> atomic read
// notes: surface; the child handle stays task-local (moved into the waiter task),
// notes: reached by a cloneable ChildHandle (pid + signaller seam + close Notify)
// notes: for kill/interrupt. is_spawned reads state.child (a brief lock) rather
// notes: than an atomic — simpler, single source of truth, matches TS `!!child`.
// notes: SIGTERM/SIGKILL/SIGINT shell out to `kill -<SIG> <pid>` (no libc/nix in
// notes: the allowlist; house style from background-tasks::kill). spawn argv,
// notes: stdin control_request envelopes, sendMessage/respondToPermission (incl.
// notes: ExitPlanMode/AskUserQuestion + promoteToLocalSettings), interrupt (10s
// notes: SIGINT fallback), kill (SIGTERM→SIGKILL 3s) copied verbatim. Tests
// notes: ported: session-spawn-args (against build_args), control-requests
// notes: (ClaudeAdapter block), kill-awaits-close, stop-background-task — with a
// notes: capturable mpsc stdin + a ChildHandle test double (tx.is_closed() ≈
// notes: stdin.destroyed). Production spawn plumbing is by-inspection (no unit
// notes: test spawns a real `claude`, same as the codex session port).
