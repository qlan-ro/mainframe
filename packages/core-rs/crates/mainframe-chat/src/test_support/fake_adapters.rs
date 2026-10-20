//! The `AdapterPort` half of [`FakeDeps`]: sessions, titles, fork pins and
//! transcript lookups, all scripted by the test.

use mainframe_types::sync::LockExt as _;
use std::collections::HashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{
    AdapterSession, BoxFuture, ForkPinError, ForkPinRequest, PlanModeActionHandler,
};
use mainframe_services::quota::{IngestMode, QuotaManager};
use mainframe_types::adapter::{AdapterInfo, ForkSource, ProviderQuota, SessionOptions};
use mainframe_types::chat::{ChatMessage, ResolvedTuning};
use mainframe_types::display::{DisplayMessage, ToolCategories};
use mainframe_types::transcript::TranscriptLocation;

use super::fake_projection::ProjectorFn;
use super::{FakeDeps, FakeSession};
use crate::chat_manager::{AdapterForkInfo, AdapterPort};

/// `pin_fork_point`'s configurable failure, for fork_chat's status-mapping tests.
#[derive(Clone)]
pub(crate) enum PinFailure {
    Unsupported,
    TranscriptMissing,
    Failed(String),
    PointNotFound(String),
}

#[derive(Default)]
pub(crate) struct FakeAdapterPort {
    /// `locate_transcript`'s answer (`None` = cannot determine).
    pub(crate) transcript_present: Mutex<Option<bool>>,
    pub(crate) transcript_location: Mutex<Option<TranscriptLocation>>,
    /// Every `(adapter_id, session_id)` `locate_transcript` was asked about.
    pub(crate) locate_calls: Mutex<Vec<(String, String)>>,
    /// When `Some`, `create_session` yields a `FakeSession` whose
    /// `load_history` returns it (unless `session_to_return` is set).
    pub(crate) history: Mutex<Option<Vec<ChatMessage>>>,
    /// Counts `load_history` across every session this fake hands out.
    pub(crate) history_loads: Arc<AtomicUsize>,
    /// `AdapterSession::history_sources()` for every `FakeSession` handed out.
    pub(crate) history_sources: Mutex<Vec<std::path::PathBuf>>,
    /// When `Some`, `create_session` returns it instead of a `FakeSession`.
    pub(crate) session_to_return: Mutex<Option<Arc<dyn AdapterSession>>>,
    /// Every `SessionOptions` `create_session` was called with, in order.
    pub(crate) created_sessions: Mutex<Vec<SessionOptions>>,
    /// What every `FakeSession` this hands out sets `spawn_ok` to.
    pub(crate) spawn_ok: Mutex<bool>,
    /// What `generate_title` returns.
    pub(crate) generated_title: Mutex<Option<String>>,
    /// The `content` of every `generate_title` call, in order.
    pub(crate) generate_title_calls: Mutex<Vec<String>>,
    /// When set, `generate_title` awaits `notified()` on it before returning.
    pub(crate) title_gate: Mutex<Option<Arc<tokio::sync::Notify>>>,
    /// What `create_plan_mode_handler` returns.
    pub(crate) plan_handler: Mutex<Option<Arc<dyn PlanModeActionHandler>>>,
    /// What `adapter_supports_no_persistence` answers.
    pub(crate) no_persistence_capability: Mutex<bool>,
    /// `adapter_fork_info(adapter_id).fork`.
    pub(crate) fork_capable: Mutex<bool>,
    /// `adapter_fork_info(adapter_id).unavailable_reason`.
    pub(crate) fork_unavailable_reason: Mutex<Option<String>>,
    /// When `Some`, `pin_fork_point` fails with this instead of echoing the
    /// source session id back as the snapshot path.
    pub(crate) pin_failure: Mutex<Option<PinFailure>>,
    /// Every `pin_fork_point` request, in order.
    pub(crate) pin_requests: Mutex<Vec<ForkPinRequest>>,
    /// `adapter_info(adapter_id)` answers, keyed by adapter id.
    pub(crate) adapter_infos: Mutex<HashMap<String, AdapterInfo>>,
    /// What `initial_transcript_path` answers.
    pub(crate) transcript_path: Mutex<Option<String>>,
    /// Every `(adapter_id, session_id, cwd)` `initial_transcript_path` saw.
    pub(crate) transcript_lookups: Mutex<Vec<(String, String, String)>>,
    /// When set, `on_provider_quota` sparse-merges into it (`IngestMode::Push`).
    pub(crate) quota: Mutex<Option<Arc<QuotaManager>>>,
    /// What `get_tool_categories` answers.
    pub(crate) tool_categories: Mutex<Option<ToolCategories>>,
    /// What `resolve_tuning` answers.
    pub(crate) resolved_tuning: Mutex<Option<ResolvedTuning>>,
    /// When set, backs `display_projector` instead of the 1:1 echo.
    pub(crate) projector: Mutex<Option<ProjectorFn>>,
    pub(crate) projector_factory: Option<fn() -> Box<dyn mainframe_display::DisplayProjector>>,
    /// Literal tags `strip_command_tags` removes; empty leaves text untouched.
    pub(crate) strip_tags: Mutex<Vec<String>>,
}

impl AdapterPort for FakeDeps {
    fn get_tool_categories(&self, _chat_id: &str) -> Option<ToolCategories> {
        self.adapters.tool_categories.lock_recover().clone()
    }
    fn prepare_messages_for_client(
        &self,
        _chat_id: &str,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        FakeAdapterPort::convert(raw, categories)
    }
    fn display_projector(&self, _chat_id: &str) -> Box<dyn mainframe_display::DisplayProjector> {
        if let Some(factory) = self.adapters.projector_factory {
            return factory();
        }
        let custom = self.adapters.projector.lock_recover().clone();
        Box::new(mainframe_display::FullRebuildProjector::new(
            move |raw, overlay, categories| {
                if let Some(project) = &custom {
                    return project(raw, overlay, categories);
                }
                let combined: Vec<ChatMessage> = match overlay {
                    Some(o) => raw
                        .iter()
                        .cloned()
                        .chain(std::iter::once(o.clone()))
                        .collect(),
                    None => raw.to_vec(),
                };
                FakeAdapterPort::convert(&combined, categories)
            },
        ))
    }
    fn strip_command_tags(&self, text: &str) -> String {
        self.adapters
            .strip_tags
            .lock_recover()
            .iter()
            .fold(text.to_string(), |acc, tag| acc.replace(tag, ""))
    }
    fn initial_transcript_path(
        &self,
        adapter_id: &str,
        session_id: &str,
        cwd: &str,
    ) -> Option<String> {
        self.adapters.transcript_lookups.lock_recover().push((
            adapter_id.to_string(),
            session_id.to_string(),
            cwd.to_string(),
        ));
        self.adapters.transcript_path.lock_recover().clone()
    }
    fn create_session(
        &self,
        _adapter_id: &str,
        options: SessionOptions,
    ) -> Option<Arc<dyn AdapterSession>> {
        self.adapters.created_sessions.lock_recover().push(options);
        if let Some(session) = self.adapters.session_to_return.lock_recover().clone() {
            return Some(session);
        }
        self.adapters.history.lock_recover().clone().map(|history| {
            Arc::new(FakeSession {
                history,
                history_loads: Some(Arc::clone(&self.adapters.history_loads)),
                history_sources: self.adapters.history_sources.lock_recover().clone(),
                spawn_ok: *self.adapters.spawn_ok.lock_recover(),
                ..Default::default()
            }) as Arc<dyn AdapterSession>
        })
    }
    fn create_plan_mode_handler(
        &self,
        _adapter_id: &str,
    ) -> Option<Arc<dyn PlanModeActionHandler>> {
        self.adapters.plan_handler.lock_recover().clone()
    }
    fn scan_loaded_history<'a>(
        &'a self,
        _chat_id: &'a str,
        _canonical: Option<&'a [ChatMessage]>,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn resolve_tuning<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, Option<ResolvedTuning>> {
        let resolved = self.adapters.resolved_tuning.lock_recover().clone();
        Box::pin(async move { resolved })
    }
    fn generate_title<'a>(
        &'a self,
        _adapter_id: &'a str,
        content: &'a str,
        _binary: &'a str,
    ) -> BoxFuture<'a, Option<String>> {
        self.adapters
            .generate_title_calls
            .lock_recover()
            .push(content.to_string());
        let gate = self.adapters.title_gate.lock_recover().clone();
        let result = self.adapters.generated_title.lock_recover().clone();
        Box::pin(async move {
            if let Some(gate) = gate {
                gate.notified().await;
            }
            result
        })
    }
    fn on_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
        // Mirror DaemonChatDeps: session-pushed quota sparse-merges (Push).
        if let Some(q) = self.adapters.quota.lock_recover().as_ref() {
            q.ingest(adapter_id, quota, IngestMode::Push);
        }
    }
    fn locate_transcript<'a>(
        &'a self,
        adapter_id: &'a str,
        session_id: &'a str,
        _project_path: &'a str,
        session_file_path: Option<&'a str>,
    ) -> BoxFuture<'a, Option<TranscriptLocation>> {
        self.adapters
            .locate_calls
            .lock_recover()
            .push((adapter_id.to_string(), session_id.to_string()));
        if let Some(location) = self.adapters.transcript_location.lock_recover().clone() {
            return Box::pin(async move { Some(location) });
        }
        let present = *self.adapters.transcript_present.lock_recover();
        let path = session_file_path
            .map(str::to_string)
            .unwrap_or_else(|| format!("/transcripts/{session_id}.jsonl"));
        Box::pin(async move {
            present.map(|present| {
                if present {
                    TranscriptLocation::Present(path)
                } else {
                    TranscriptLocation::Missing
                }
            })
        })
    }
    fn adapter_supports_no_persistence(&self, _adapter_id: &str) -> bool {
        *self.adapters.no_persistence_capability.lock_recover()
    }
    fn adapter_fork_info(&self, adapter_id: &str) -> AdapterForkInfo {
        AdapterForkInfo {
            name: adapter_id.to_string(),
            fork: *self.adapters.fork_capable.lock_recover(),
            unavailable_reason: self.adapters.fork_unavailable_reason.lock_recover().clone(),
        }
    }
    fn pin_fork_point<'a>(
        &'a self,
        _adapter_id: &'a str,
        request: ForkPinRequest,
    ) -> BoxFuture<'a, Result<ForkSource, ForkPinError>> {
        let failure = self.adapters.pin_failure.lock_recover().clone();
        self.adapters
            .pin_requests
            .lock_recover()
            .push(request.clone());
        Box::pin(async move {
            match failure {
                Some(PinFailure::Unsupported) => Err(ForkPinError::Unsupported),
                Some(PinFailure::TranscriptMissing) => Err(ForkPinError::TranscriptMissing),
                Some(PinFailure::Failed(message)) => Err(ForkPinError::Failed(message)),
                Some(PinFailure::PointNotFound(reason)) => Err(ForkPinError::PointNotFound(reason)),
                // A cut is echoed as the pinned turn so tests can see it
                // survive into the stored pending fork.
                None => Ok(ForkSource {
                    source_session_id: request.source_session_id,
                    resume_path: Some(format!("{}/snapshot.jsonl", request.dest_dir)),
                    last_turn_id: request.cut.map(|cut| cut.vendor_message_id),
                }),
            }
        })
    }
    fn adapter_info(&self, adapter_id: &str) -> Option<AdapterInfo> {
        self.adapters
            .adapter_infos
            .lock_recover()
            .get(adapter_id)
            .cloned()
    }
}
