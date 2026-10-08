use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;

use mainframe_adapter_api::{
    AdapterError, AdapterSession, BoxFuture, ContextFiles, ImageInput, SessionSink,
    StopBackgroundTaskResult,
};
use mainframe_types::adapter::{
    AdapterProcess, AdapterProcessStatus, ControlResponse, ForkSource, SessionOptions,
    SessionSpawnOptions,
};
use mainframe_types::chat::{ChatMessage, ResolvedTuning};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::settings::ExecutionMode;
use nanoid::nanoid;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

use crate::approval_handler::{ApprovalHandler, PlanContext};
use crate::event_mapper::{CodexSessionState, handle_notification};
use crate::fork::ThreadTarget;
use crate::history_convert::convert_thread_items;
use crate::history_load::load_history_inner;
use crate::jsonrpc::{JsonRpcClient, JsonRpcHandlers};
use crate::rollout_reader::{RolloutReaderDeps, read_rollout_items};
use crate::thread_registry::{ThreadRegistryDeps, lookup_agent_metadata_with};
use crate::thread_request::thread_request_for;
use crate::turn_config::{CodexProviderTuning, build_turn_config};
use crate::turn_model::{non_empty, resolve_turn_model};
use crate::types::{ThreadStartResult, TurnStartResult};

#[path = "session_model.rs"]
mod model;
#[path = "turn_steer.rs"]
mod steer;

const HANDSHAKE_TIMEOUT_MS: u64 = 10_000;
type OnExitCallback = Box<dyn FnOnce() + Send>;

#[derive(Clone)]
struct PendingConfig {
    model: Option<String>,
    permission_mode: ExecutionMode,
    plan_mode: bool,
    tuning: Option<ResolvedTuning>,
    codex_provider_tuning: CodexProviderTuning,
    no_persistence: bool,
    /// Set from `SessionSpawnOptions::orchestration_mcp.is_some()` at spawn
    /// time: whether this chat's `codex app-server` actually has the
    /// `mainframe` MCP server, so `turn/start` only carries the orchestration
    /// `additionalContext` entry (`session_prompt.rs::prompt_params`) for a
    /// chat that really has the tools.
    orchestration_enabled: bool,
}

impl Default for PendingConfig {
    fn default() -> Self {
        Self {
            model: None,
            permission_mode: ExecutionMode::Default,
            plan_mode: false,
            tuning: None,
            codex_provider_tuning: CodexProviderTuning::default(),
            no_persistence: false,
            orchestration_enabled: false,
        }
    }
}
#[derive(Debug, Clone, Default)]
pub struct CodexScanDeps {
    pub registry: ThreadRegistryDeps,
    pub rollout: RolloutReaderDeps,
}

pub struct CodexSession {
    id: String,
    project_path: String,
    resume_thread_id: Option<String>,
    fork_source: Option<ForkSource>,
    on_exit_callback: Arc<Mutex<Option<OnExitCallback>>>,
    client: Arc<Mutex<Option<Arc<JsonRpcClient>>>>,
    approval_handler: Arc<Mutex<Option<Arc<ApprovalHandler>>>>,
    sink: Arc<Mutex<Arc<dyn SessionSink>>>,
    state: Arc<Mutex<CodexSessionState>>,
    config: Arc<Mutex<PendingConfig>>,
    pid: AtomicI64,
    status: Arc<Mutex<AdapterProcessStatus>>,
    resolved_path: ResolvedPath,
    scan_deps: Arc<Mutex<Option<CodexScanDeps>>>,
    transcript_present_override: Arc<Mutex<Option<bool>>>,
    history_executable: Arc<Mutex<String>>,
}

impl CodexSession {
    pub fn new(
        options: SessionOptions,
        on_exit: Option<Box<dyn FnOnce() + Send>>,
        resolved_path: ResolvedPath,
        background_tasks: Arc<BackgroundTaskTracker>,
    ) -> Self {
        let state = CodexSessionState {
            mainframe_chat_id: options.mainframe_chat_id.clone(),
            background_tasks: Some(background_tasks),
            ..CodexSessionState::default()
        };
        Self {
            id: nanoid!(),
            project_path: options.project_path,
            resume_thread_id: options.chat_id,
            fork_source: options.fork_source,
            on_exit_callback: Arc::new(Mutex::new(on_exit)),
            client: Arc::new(Mutex::new(None)),
            approval_handler: Arc::new(Mutex::new(None)),
            sink: Arc::new(Mutex::new(null_sink())),
            state: Arc::new(Mutex::new(state)),
            config: Arc::new(Mutex::new(PendingConfig::default())),
            pid: AtomicI64::new(0),
            status: Arc::new(Mutex::new(AdapterProcessStatus::Starting)),
            resolved_path,
            scan_deps: Arc::new(Mutex::new(None)),
            transcript_present_override: Arc::new(Mutex::new(None)),
            history_executable: Arc::new(Mutex::new("codex".to_string())),
        }
    }
    pub fn set_scan_deps(&self, deps: CodexScanDeps) {
        *self.scan_deps.lock().unwrap_or_else(|e| e.into_inner()) = Some(deps);
    }
    pub fn set_transcript_present_override(&self, present: bool) {
        *self
            .transcript_present_override
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(present);
    }
    pub fn set_history_executable(&self, executable: &str) {
        *self
            .history_executable
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = executable.to_string();
    }
    pub fn set_on_exit(&self, cb: OnExitCallback) {
        *self
            .on_exit_callback
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(cb);
    }
    pub fn set_codex_provider_tuning(&self, tuning: CodexProviderTuning) {
        self.config
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .codex_provider_tuning = tuning;
    }
}

pub(crate) fn de<T: DeserializeOwned>(v: Value) -> Result<T, AdapterError> {
    serde_json::from_value(v).map_err(|e| AdapterError::Message(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
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
    #[test]
    fn permission_mode_policy_coerces_auto_to_interactive() {
        let interactive = ("on-request".to_string(), "workspace-write".to_string());
        assert_eq!(permission_mode_policy(ExecutionMode::Default), interactive);
        assert_eq!(permission_mode_policy(ExecutionMode::Auto), interactive);
        assert_eq!(
            permission_mode_policy(ExecutionMode::Yolo),
            ("never".to_string(), "danger-full-access".to_string())
        );
    }
}

#[cfg(test)]
mod command_metadata_tests;

#[cfg(test)]
mod presentation_exit_tests;

#[path = "session_adapter.rs"]
mod adapter;
#[path = "session_history.rs"]
mod history;
#[path = "session_lifecycle.rs"]
mod lifecycle;
#[path = "session_prompt.rs"]
mod prompt;
#[path = "session_spawn.rs"]
mod spawn;
#[path = "session_thread.rs"]
mod thread;
use lifecycle::null_sink;
#[cfg(test)]
use spawn::build_app_server_command;
pub(crate) use spawn::spawn_temp_app_server;
#[cfg(test)]
use thread::permission_mode_policy;
