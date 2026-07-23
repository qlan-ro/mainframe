//! Ported from `packages/core/src/plugins/builtin/codex/session.ts`.
//!
//! `CodexSession` — a live Codex app-server session implementing `AdapterSession`.
//! Spawn argv (`codex app-server`), the initialize/initialized handshake (10s),
//! lazy thread/start vs thread/resume, turn/start config, and the loadHistory
//! temp-app-server + thread/read recursion are copied from the TS.

use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use mainframe_runtime::ResolvedPath;

use mainframe_adapter_api::{
    AdapterError, AdapterSession, BoxFuture, ContextFiles, ImageInput, SessionSink,
    StopBackgroundTaskResult,
};
use mainframe_types::adapter::{
    AdapterProcess, AdapterProcessStatus, ControlResponse, SessionOptions, SessionSpawnOptions,
};
use mainframe_types::chat::{ChatMessage, ResolvedTuning};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::settings::ExecutionMode;
use nanoid::nanoid;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

use crate::approval_handler::{ApprovalHandler, PlanContext};
use crate::event_mapper::{CodexSessionState, handle_notification};
use crate::history::convert_thread_items;
use crate::jsonrpc::{JsonRpcClient, JsonRpcHandlers};
use crate::rollout_reader::read_rollout_items;
use crate::thread_registry::{AgentMetadata, lookup_agent_metadata};
use crate::turn_config::{CodexProviderTuning, build_turn_config};
use crate::types::{
    ThreadItem, ThreadReadResult, ThreadResumeResult, ThreadStartResult, TurnStartResult,
};

const HANDSHAKE_TIMEOUT_MS: u64 = 10_000;

/// A `SessionSink` that ignores every callback (the TS `nullSink`).
struct NullSink;
impl SessionSink for NullSink {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(
        &self,
        _content: Vec<mainframe_types::chat::MessageContent>,
        _metadata: Option<mainframe_types::adapter::MessageMetadata>,
    ) {
    }
    fn on_tool_result(&self, _content: Vec<mainframe_types::chat::MessageContent>) {}
    fn on_permission(&self, _request: mainframe_adapter_api::ControlRequest) {}
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

fn null_sink() -> Arc<dyn SessionSink> {
    Arc::new(NullSink)
}

/// One-shot on-exit callback (the TS `onExit` ctor arg).
type OnExitCallback = Box<dyn FnOnce() + Send>;

struct PendingConfig {
    model: Option<String>,
    permission_mode: ExecutionMode,
    plan_mode: bool,
    tuning: Option<ResolvedTuning>,
    codex_provider_tuning: CodexProviderTuning,
}

impl Default for PendingConfig {
    fn default() -> Self {
        Self {
            model: None,
            permission_mode: ExecutionMode::Default,
            plan_mode: false,
            tuning: None,
            codex_provider_tuning: CodexProviderTuning::default(),
        }
    }
}

pub struct CodexSession {
    id: String,
    project_path: String,
    resume_thread_id: Option<String>,
    on_exit_callback: Arc<Mutex<Option<OnExitCallback>>>,
    client: Arc<Mutex<Option<Arc<JsonRpcClient>>>>,
    approval_handler: Arc<Mutex<Option<Arc<ApprovalHandler>>>>,
    sink: Arc<Mutex<Arc<dyn SessionSink>>>,
    state: Arc<Mutex<CodexSessionState>>,
    config: Arc<Mutex<PendingConfig>>,
    pid: AtomicI64,
    status: Arc<Mutex<AdapterProcessStatus>>,
    /// Boot-resolved login-shell `PATH`, applied to the spawned `codex` CLI so
    /// packaged builds find it outside the bare launchd `PATH` (mirrors the TS
    /// `enrichPath` env mutation).
    resolved_path: ResolvedPath,
}

impl CodexSession {
    pub fn new(
        options: SessionOptions,
        on_exit: Option<Box<dyn FnOnce() + Send>>,
        resolved_path: ResolvedPath,
    ) -> Self {
        Self {
            id: nanoid!(),
            project_path: options.project_path,
            resume_thread_id: options.chat_id,
            on_exit_callback: Arc::new(Mutex::new(on_exit)),
            client: Arc::new(Mutex::new(None)),
            approval_handler: Arc::new(Mutex::new(None)),
            sink: Arc::new(Mutex::new(null_sink())),
            state: Arc::new(Mutex::new(CodexSessionState::default())),
            config: Arc::new(Mutex::new(PendingConfig::default())),
            pid: AtomicI64::new(0),
            status: Arc::new(Mutex::new(AdapterProcessStatus::Starting)),
            resolved_path,
        }
    }

    /// Set the one-shot on-exit callback (used by `CodexAdapter::create_session` to
    /// remove the session from its live set; mirrors the TS `onExit` ctor arg,
    /// deferred so the adapter can capture the session's own id).
    pub fn set_on_exit(&self, cb: OnExitCallback) {
        *self
            .on_exit_callback
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(cb);
    }

    /// Called by lifecycle-manager (H1) to push Codex-only provider defaults.
    pub fn set_codex_provider_tuning(&self, tuning: CodexProviderTuning) {
        self.config
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .codex_provider_tuning = tuning;
    }

    fn map_permission_mode(&self, mode: ExecutionMode) -> (String, String) {
        if mode == ExecutionMode::Yolo {
            ("never".to_string(), "danger-full-access".to_string())
        } else {
            ("on-request".to_string(), "workspace-write".to_string())
        }
    }

    fn map_sandbox_policy(&self, sandbox: &str) -> Value {
        let kind = match sandbox {
            "danger-full-access" => "dangerFullAccess",
            "read-only" => "readOnly",
            _ => "workspaceWrite",
        };
        json!({ "type": kind })
    }
}

fn de<T: DeserializeOwned>(v: Value) -> Result<T, AdapterError> {
    serde_json::from_value(v).map_err(|e| AdapterError::Message(e.to_string()))
}

fn initialize_params(with_capabilities: bool) -> Value {
    let mut m = Map::new();
    m.insert(
        "clientInfo".into(),
        json!({ "name": "mainframe", "title": "Mainframe", "version": "1.0.0" }),
    );
    if with_capabilities {
        m.insert("capabilities".into(), json!({ "experimentalApi": true }));
    }
    Value::Object(m)
}

/// Build the configured (unspawned) `codex app-server` command. Extracted so the
/// spawn-env contract — notably the boot-resolved login-shell `PATH` — is
/// unit-testable without launching a real CLI.
fn build_app_server_command(
    executable: &str,
    cwd: Option<&Path>,
    path: &str,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(executable);
    cmd.arg("app-server")
        .env("PATH", path)
        .env("FORCE_COLOR", "0")
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd
}

/// Spawn a temporary `<executable> app-server`, perform the handshake, and return
/// the ready client. Shared by `load_history` and the adapter's model listing;
/// `executable` is the resolved CLI path (`'codex'` by default, or a configured
/// binary for `probe_models`).
pub(crate) async fn spawn_temp_app_server(
    executable: &str,
    cwd: Option<&Path>,
    with_capabilities: bool,
    path: &str,
) -> Result<Arc<JsonRpcClient>, AdapterError> {
    let mut cmd = build_app_server_command(executable, cwd, path);
    let child = cmd
        .spawn()
        .map_err(|e| AdapterError::Message(e.to_string()))?;
    let client = Arc::new(JsonRpcClient::new(
        child,
        JsonRpcHandlers {
            on_notification: Box::new(|_, _| {}),
            on_request: Box::new(|_, _, _| {}),
            on_error: Box::new(|_| {}),
            on_exit: Box::new(|_| {}),
        },
    ));
    client
        .request("initialize", Some(initialize_params(with_capabilities)))
        .await
        .map_err(|e| AdapterError::Message(e.0))?;
    client.notify("initialized", None);
    Ok(client)
}

impl AdapterSession for CodexSession {
    fn id(&self) -> &str {
        &self.id
    }
    fn adapter_id(&self) -> &str {
        "codex"
    }
    fn project_path(&self) -> &str {
        &self.project_path
    }
    fn is_spawned(&self) -> bool {
        self.client
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
    }

    fn get_process_info(&self) -> Option<AdapterProcess> {
        if self
            .client
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_none()
        {
            return None;
        }
        let chat_id = self
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .thread_id
            .clone()
            .unwrap_or_default();
        Some(AdapterProcess {
            id: self.id.clone(),
            adapter_id: "codex".to_string(),
            chat_id,
            pid: self.pid.load(Ordering::SeqCst),
            status: *self.status.lock().unwrap_or_else(|e| e.into_inner()),
            project_path: self.project_path.clone(),
            model: self
                .config
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .model
                .clone(),
        })
    }

    fn spawn(
        &self,
        options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin(async move {
            let options = options.unwrap_or(SessionSpawnOptions {
                model: None,
                permission_mode: None,
                plan_mode: None,
                executable_path: None,
                system_prompt: None,
                tuning: None,
            });
            let sink = sink.unwrap_or_else(null_sink);
            *self.sink.lock().unwrap_or_else(|e| e.into_inner()) = sink.clone();
            {
                let mut cfg = self.config.lock().unwrap_or_else(|e| e.into_inner());
                cfg.model = options.model.clone();
                cfg.permission_mode = options.permission_mode.unwrap_or(ExecutionMode::Default);
                cfg.plan_mode = options.plan_mode.unwrap_or(false);
                cfg.tuning = options.tuning.clone();
            }

            if std::fs::metadata(&self.project_path).is_err() {
                return Err(AdapterError::Message(format!(
                    "Project directory does not exist or is not accessible: {}",
                    self.project_path
                )));
            }

            let executable = options
                .executable_path
                .clone()
                .unwrap_or_else(|| "codex".to_string());
            let mut cmd = build_app_server_command(
                &executable,
                Some(Path::new(&self.project_path)),
                self.resolved_path.as_str(),
            );
            let child = cmd
                .spawn()
                .map_err(|e| AdapterError::Message(e.to_string()))?;
            self.pid
                .store(child.id().map(|p| p as i64).unwrap_or(0), Ordering::SeqCst);
            *self.status.lock().unwrap_or_else(|e| e.into_inner()) = AdapterProcessStatus::Starting;

            let approval = Arc::new(ApprovalHandler::new(sink.clone()));
            *self
                .approval_handler
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(approval.clone());

            let handlers = self.build_handlers(approval);
            let client = Arc::new(JsonRpcClient::new(child, handlers));
            *self.client.lock().unwrap_or_else(|e| e.into_inner()) = Some(client.clone());

            // Handshake — 10s cap covering initialize + initialized.
            match tokio::time::timeout(
                Duration::from_millis(HANDSHAKE_TIMEOUT_MS),
                client.request("initialize", Some(initialize_params(true))),
            )
            .await
            {
                Ok(Ok(_)) => {
                    client.notify("initialized", None);
                    *self.status.lock().unwrap_or_else(|e| e.into_inner()) =
                        AdapterProcessStatus::Ready;
                }
                Ok(Err(e)) => return Err(AdapterError::Message(e.0)),
                Err(_) => {
                    tracing::error!(module = "codex:session", session_id = %self.id, "codex handshake timeout");
                    sink.on_error(AdapterError::Message("handshake timeout".to_string()));
                    client.close();
                    return Err(AdapterError::Message("handshake timeout".to_string()));
                }
            }

            tracing::info!(
                module = "codex:session",
                session_id = %self.id,
                project_path = %self.project_path,
                resume = self.resume_thread_id.is_some(),
                "codex session spawned"
            );

            // Fire onInit immediately so the UI transitions from 'starting' to 'idle'.
            sink.on_init(&self.id);

            self.get_process_info()
                .ok_or_else(|| AdapterError::Message("no process info".to_string()))
        })
    }

    fn send_message(
        &self,
        message: String,
        images: Vec<ImageInput>,
        _uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            let client = self
                .client
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            let Some(client) = client else {
                return Err(AdapterError::Message(format!(
                    "Session {} not spawned",
                    self.id
                )));
            };

            if !images.is_empty() {
                tracing::warn!(
                    module = "codex:session",
                    session_id = %self.id,
                    count = images.len(),
                    "codex: image attachments not supported yet, skipping"
                );
            }
            let input = json!([{ "type": "text", "text": message, "text_elements": [] }]);

            let thread_id = self
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .thread_id
                .clone();
            let (model, permission_mode, plan_mode, tuning, codex_tuning) = {
                let cfg = self.config.lock().unwrap_or_else(|e| e.into_inner());
                (
                    cfg.model.clone(),
                    cfg.permission_mode,
                    cfg.plan_mode,
                    cfg.tuning.clone(),
                    cfg.codex_provider_tuning.clone(),
                )
            };

            // First message: start or resume thread.
            if thread_id.is_none() {
                let new_thread_id = if let Some(resume) = &self.resume_thread_id {
                    let mut p = Map::new();
                    p.insert("threadId".into(), json!(resume));
                    if let Some(m) = &model {
                        p.insert("model".into(), json!(m));
                    }
                    p.insert("cwd".into(), json!(self.project_path));
                    p.insert("persistExtendedHistory".into(), json!(true));
                    p.insert("persistFullHistory".into(), json!(true));
                    let res: ThreadResumeResult = de(client
                        .request("thread/resume", Some(Value::Object(p)))
                        .await
                        .map_err(|e| AdapterError::Message(e.0))?)?;
                    res.thread.id
                } else {
                    let (approval_policy, sandbox) = self.map_permission_mode(permission_mode);
                    let mut p = Map::new();
                    if let Some(m) = &model {
                        p.insert("model".into(), json!(m));
                    }
                    p.insert("cwd".into(), json!(self.project_path));
                    p.insert("approvalPolicy".into(), json!(approval_policy));
                    p.insert("sandbox".into(), json!(sandbox));
                    p.insert("experimentalRawEvents".into(), json!(true));
                    p.insert("persistExtendedHistory".into(), json!(true));
                    p.insert("persistFullHistory".into(), json!(true));
                    let res: ThreadStartResult = de(client
                        .request("thread/start", Some(Value::Object(p)))
                        .await
                        .map_err(|e| AdapterError::Message(e.0))?)?;
                    res.thread.id
                };
                self.state
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .thread_id = Some(new_thread_id.clone());
                // Persist the real Codex thread ID immediately.
                self.sink
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone()
                    .on_init(&new_thread_id);
            }

            let thread_id = self
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .thread_id
                .clone()
                .unwrap_or_default();
            let (approval_policy, sandbox) = self.map_permission_mode(permission_mode);
            let default_resolved = ResolvedTuning {
                effort: None,
                fast: false,
                ultracode: false,
                adaptive_thinking: false,
            };
            let turn_cfg = build_turn_config(
                tuning.as_ref().unwrap_or(&default_resolved),
                &codex_tuning,
                model.as_deref(),
                if plan_mode { "plan" } else { "default" },
            );

            let mut p = Map::new();
            p.insert("threadId".into(), json!(thread_id));
            p.insert("input".into(), input);
            p.insert("approvalPolicy".into(), json!(approval_policy));
            p.insert("sandboxPolicy".into(), self.map_sandbox_policy(&sandbox));
            p.insert(
                "collaborationMode".into(),
                serde_json::to_value(&turn_cfg.collaboration_mode)
                    .map_err(|e| AdapterError::Message(e.to_string()))?,
            );
            if let Some(m) = &model {
                p.insert("model".into(), json!(m));
            }
            if let Some(st) = &turn_cfg.service_tier {
                p.insert("serviceTier".into(), json!(st));
            }
            if let Some(pers) = &turn_cfg.personality {
                p.insert("personality".into(), json!(pers));
            }
            if let Some(sum) = &turn_cfg.summary {
                p.insert("summary".into(), json!(sum));
            }
            let _: TurnStartResult = de(client
                .request("turn/start", Some(Value::Object(p)))
                .await
                .map_err(|e| AdapterError::Message(e.0))?)?;

            *self.status.lock().unwrap_or_else(|e| e.into_inner()) = AdapterProcessStatus::Running;
            Ok(())
        })
    }

    fn cancel_queued_message(&self, _uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(false) })
    }

    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            let client = self
                .client
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            let Some(client) = client else {
                return Ok(());
            };
            if let Some(approval) = self
                .approval_handler
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
            {
                approval.reject_all();
            }
            client.close();
            let _ = tokio::time::timeout(Duration::from_millis(3000), client.closed()).await;
            *self.client.lock().unwrap_or_else(|e| e.into_inner()) = None;
            Ok(())
        })
    }

    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            let client = self
                .client
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            let (thread_id, turn_id) = {
                let st = self.state.lock().unwrap_or_else(|e| e.into_inner());
                (st.thread_id.clone(), st.current_turn_id.clone())
            };
            let (Some(client), Some(thread_id), Some(turn_id)) = (client, thread_id, turn_id)
            else {
                return Ok(());
            };
            client
                .request(
                    "turn/interrupt",
                    Some(json!({ "threadId": thread_id, "turnId": turn_id })),
                )
                .await
                .map_err(|e| AdapterError::Message(e.0))?;
            Ok(())
        })
    }

    fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            if let Some(approval) = self
                .approval_handler
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
            {
                approval.resolve(&response);
            }
            Ok(())
        })
    }

    fn set_model(&self, model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.config.lock().unwrap_or_else(|e| e.into_inner()).model = Some(model);
            Ok(())
        })
    }

    fn set_permission_mode(&self, mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.config
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .permission_mode = mode;
            Ok(())
        })
    }

    fn set_plan_mode(&self, on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.config
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .plan_mode = on;
            Ok(())
        })
    }

    fn apply_tuning(&self, tuning: ResolvedTuning) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            self.config.lock().unwrap_or_else(|e| e.into_inner()).tuning = Some(tuning);
            Ok(())
        })
    }

    fn send_command(
        &self,
        _command: String,
        _args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            tracing::warn!(module = "codex:session", session_id = %self.id, "codex: sendCommand not supported");
            Ok(())
        })
    }

    fn get_context_files(&self) -> ContextFiles {
        // TODO(port): read Codex-equivalent context files.
        ContextFiles::default()
    }

    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin(async move {
            let Some(resume_thread_id) = self.resume_thread_id.clone() else {
                return Ok(Vec::new());
            };

            let temp = match spawn_temp_app_server(
                "codex",
                Some(Path::new(&self.project_path)),
                true,
                self.resolved_path.as_str(),
            )
            .await
            {
                Ok(c) => c,
                Err(err) => {
                    tracing::warn!(module = "codex:session", err = %err, thread_id = %resume_thread_id, "codex: failed to load history");
                    return Ok(Vec::new());
                }
            };

            let result = load_history_inner(&temp, &resume_thread_id, &self.project_path).await;
            temp.close();
            match result {
                Ok(msgs) => Ok(msgs),
                Err(err) => {
                    tracing::warn!(module = "codex:session", err = %err, thread_id = %resume_thread_id, "codex: failed to load history");
                    Ok(Vec::new())
                }
            }
        })
    }

    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn stop_background_task(
        &self,
        _task_id: String,
    ) -> BoxFuture<'_, Result<StopBackgroundTaskResult, AdapterError>> {
        Box::pin(async {
            Ok(StopBackgroundTaskResult {
                ok: false,
                error: Some("unsupported".to_string()),
            })
        })
    }
}

impl CodexSession {
    fn build_handlers(&self, approval: Arc<ApprovalHandler>) -> JsonRpcHandlers {
        let sink_n = self.sink.clone();
        let state_n = self.state.clone();
        let state_r = self.state.clone();
        let config_r = self.config.clone();
        let client_slot_r = self.client.clone();
        let approval_r = approval;
        let sink_e = self.sink.clone();
        let status_x = self.status.clone();
        let client_slot_x = self.client.clone();
        let sink_x = self.sink.clone();
        let on_exit_cb = self.on_exit_callback.clone();

        JsonRpcHandlers {
            on_notification: Box::new(move |method, params| {
                let s = sink_n.lock().unwrap_or_else(|e| e.into_inner()).clone();
                handle_notification(
                    &method,
                    &params,
                    &s,
                    &mut state_n.lock().unwrap_or_else(|e| e.into_inner()),
                );
            }),
            on_request: Box::new(move |method, params, id| {
                let plan_mode = config_r.lock().unwrap_or_else(|e| e.into_inner()).plan_mode;
                let current_turn_plan = state_r
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .current_turn_plan
                    .clone();
                approval_r.set_plan_context(PlanContext {
                    plan_mode,
                    current_turn_plan,
                });
                let cs = client_slot_r.clone();
                approval_r.handle_request(
                    &method,
                    &params,
                    id,
                    Box::new(move |rpc_id, result| {
                        if let Some(c) = cs.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                            c.respond(rpc_id, result);
                        }
                    }),
                );
            }),
            on_error: Box::new(move |error| {
                let s = sink_e.lock().unwrap_or_else(|e| e.into_inner()).clone();
                s.on_error(AdapterError::Message(error));
            }),
            on_exit: Box::new(move |code| {
                *status_x.lock().unwrap_or_else(|e| e.into_inner()) = AdapterProcessStatus::Stopped;
                *client_slot_x.lock().unwrap_or_else(|e| e.into_inner()) = None;
                let s = sink_x.lock().unwrap_or_else(|e| e.into_inner()).clone();
                s.on_exit(code);
                if let Some(cb) = on_exit_cb.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    cb();
                }
            }),
        }
    }
}

async fn load_history_inner(
    temp: &Arc<JsonRpcClient>,
    resume_thread_id: &str,
    project_path: &str,
) -> Result<Vec<ChatMessage>, AdapterError> {
    let _ = project_path;
    let read: ThreadReadResult = de(temp
        .request(
            "thread/read",
            Some(json!({ "threadId": resume_thread_id, "includeTurns": true })),
        )
        .await
        .map_err(|e| AdapterError::Message(e.0))?)?;

    let all_items: Vec<ThreadItem> = read
        .thread
        .turns
        .unwrap_or_default()
        .into_iter()
        .flat_map(|t| t.items)
        .collect();

    // Collect spawned sub-agent thread ids referenced by `wait` collabAgentToolCall items.
    let mut child_thread_ids: Vec<String> = Vec::new();
    for item in &all_items {
        if let ThreadItem::CollabAgentToolCall(c) = item
            && c.tool == "wait"
            && let Some(ids) = &c.receiver_thread_ids
        {
            for id in ids {
                if !child_thread_ids.contains(id) {
                    child_thread_ids.push(id.clone());
                }
            }
        }
    }

    let agent_meta_by_thread: std::collections::HashMap<String, AgentMetadata> =
        if child_thread_ids.is_empty() {
            std::collections::HashMap::new()
        } else {
            lookup_agent_metadata(&child_thread_ids)
        };

    let mut child_items_by_thread: std::collections::HashMap<String, Vec<ThreadItem>> =
        std::collections::HashMap::new();
    for child_id in &child_thread_ids {
        // Prefer the raw rollout JSONL — it has function_call records (bash) that
        // thread/read strips. Fall back to thread/read if unavailable.
        let rollout_path = agent_meta_by_thread
            .get(child_id)
            .and_then(|m| m.rollout_path.clone());
        if let Some(rollout_path) = rollout_path {
            let items = read_rollout_items(&rollout_path, Some(child_id), None).await;
            if !items.is_empty() {
                child_items_by_thread.insert(child_id.clone(), items);
                continue;
            }
        }
        match temp
            .request(
                "thread/read",
                Some(json!({ "threadId": child_id, "includeTurns": true })),
            )
            .await
        {
            Ok(v) => {
                let child_result: ThreadReadResult = de(v)?;
                let items: Vec<ThreadItem> = child_result
                    .thread
                    .turns
                    .unwrap_or_default()
                    .into_iter()
                    .flat_map(|t| t.items)
                    .collect();
                child_items_by_thread.insert(child_id.clone(), items);
            }
            Err(err) => {
                tracing::warn!(module = "codex:session", err = %err.0, child_id, "codex: failed to read child thread, nesting will be skipped");
            }
        }
    }

    Ok(convert_thread_items(
        &all_items,
        resume_thread_id,
        &child_items_by_thread,
        &agent_meta_by_thread,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The boot-resolved login-shell PATH must land in the spawned `codex`
    /// app-server command's env (the Phase-5 blocker: packaged apps otherwise
    /// ENOENT).
    #[test]
    fn app_server_command_carries_the_resolved_path() {
        let cmd = build_app_server_command("codex", None, "/opt/homebrew/bin:/usr/bin");
        let path = cmd
            .as_std()
            .get_envs()
            .find(|(k, _)| *k == std::ffi::OsStr::new("PATH"))
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().into_owned());
        assert_eq!(path.as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
    }
}

// PORT STATUS: src/plugins/builtin/codex/session.ts (445 lines)
// confidence: medium
// todos: 3
// notes: AdapterSession impl. Concurrency per CONCURRENCY.tsv 95: state/client/
// notes: approval/sink/config/status behind Arc<Mutex<..>> (session actor + the
// notes: jsonrpc reader task share them); std Mutex guards are never held across an
// notes: .await (cloned/dropped first). Handshake is a single 10s tokio timeout over
// notes: initialize (covers the TS handshake-timer + the request). loadHistory
// notes: spawns a temp app-server, reads the parent thread, then rollout-prefers /
// notes: thread/read-falls-back for each `wait` child thread, matching the TS.
// notes: get_context_files/extract_plan_files/extract_skill_files/stop_background_task
// notes: stay stubs (TODO(port)) with identical TS behavior. set_codex_provider_tuning
// notes: is an inherent method (no trait slot yet). PendingConfig has a manual
// notes: Default (ExecutionMode has none). NullSink mirrors the TS nullSink.
