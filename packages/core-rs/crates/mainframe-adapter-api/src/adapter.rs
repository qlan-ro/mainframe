//! The behavioral half of the adapter contract: the `SessionSink`,
//! `AdapterSession`, and `Adapter` traits. The serde data half (DTOs,
//! `clamp_effort_to_supported`, `TUNABLE_FEATURES`) lives in
//! `mainframe-types::adapter`; this module imports those and adds the traits.
//!
//! Trait-object vs generic: the registry stores `Arc<dyn Adapter>` and
//! `ChatState` holds `Arc<dyn AdapterSession>`, so both are trait objects. Rust
//! async-fn-in-trait is not `dyn`-compatible and the workspace has no
//! `async-trait`, so every async method returns `BoxFuture<'_, ..>` by hand (the
//! same manual pattern already used in
//! `mainframe-services::workspace::session_files`). `SessionSink`'s methods are
//! synchronous fire-and-forget calls: the implementations emit over channels
//! (`broadcast`/`mpsc` sends, non-blocking), so no method needs to return a future.

use std::sync::Arc;

use mainframe_types::adapter::{
    AdapterCapabilities, AdapterModel, AdapterProcess, ContextUsage, ControlRequest,
    ControlResponse, DetectedPr, ForkSource, MessageMetadata, ProviderQuota, SessionOptions,
    SessionResult, SessionSpawnOptions,
};
use mainframe_types::chat::{ChatMessage, MessageContent, ResolvedTuning, TodoItem};
use mainframe_types::context::{ContextFile, SkillFileEntry};
use mainframe_types::display::ToolCategories;
use mainframe_types::settings::ExecutionMode;
use mainframe_types::transcript::TranscriptLocation;
use serde::{Deserialize, Serialize};

use crate::plan_mode_actions::PlanModeActionHandler;
use crate::{AdapterError, BoxFuture};

/// One inline image attachment for `sendMessage` (`{ mediaType, data }`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    pub media_type: String,
    pub data: String,
    /// Daemon-local file holding the decoded bytes, when the attachment store
    /// materialized one. Adapters that deliver images inline (Claude) ignore it;
    /// adapters whose CLI takes a filesystem path (Codex) need it. `None` for any
    /// call site with no materialized file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// The `{ global, project }` context-file pair returned by
/// `AdapterSession::get_context_files` / `Adapter::get_context_files`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ContextFiles {
    pub global: Vec<ContextFile>,
    pub project: Vec<ContextFile>,
}

/// Result of `AdapterSession::stop_background_task` (`{ ok, error? }`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StopBackgroundTaskResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Payload of `SessionSink::on_skill_loaded`: `{ skillName, path, content }`
/// on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSkill {
    pub skill_name: String,
    pub path: String,
    pub content: String,
}

mod adapter_session;
mod session_sink;
pub use adapter_session::AdapterSession;
pub use session_sink::SessionSink;

/// Input to `Adapter::pin_fork_point` — everything an adapter needs to pin a
/// fork's starting point without a live session. `dest_dir` is a
/// Mainframe-owned, adapter-agnostic directory the adapter may write into (the
/// Claude adapter copies the transcript there).
#[derive(Debug, Clone, PartialEq)]
pub struct ForkPinRequest {
    pub source_session_id: String,
    pub cwd: String,
    pub session_file_path: Option<String>,
    pub dest_dir: String,
    /// `None` pins the parent's current end. `Some` pins the point
    /// immediately before one of the parent's user messages (fork from a
    /// message), so the fork holds everything before it and nothing after.
    pub cut: Option<ForkCut>,
}

/// Where a from-message fork ends: just before the user message the adapter's
/// own transcript knows as `vendor_message_id`. `mainframe-chat` resolves the
/// chat message id to this vendor id, so an adapter only has to locate it.
#[derive(Debug, Clone, PartialEq)]
pub struct ForkCut {
    pub vendor_message_id: String,
}

/// The `ForkPinError::PointNotFound` reason for a cut message the provider
/// transcript doesn't hold. One copy for the chat layer and every adapter, so
/// the user sees one message for one situation.
pub const FORK_CUT_NOT_FOUND_REASON: &str = "Couldn't find this message in the chat's transcript";

/// Failure modes for `Adapter::pin_fork_point`.
#[derive(Debug, Clone, PartialEq)]
pub enum ForkPinError {
    /// This adapter has no fork mechanism (its `capabilities().fork` is `false`,
    /// or it simply never overrides the default).
    Unsupported,
    /// The parent's transcript could not be located on disk.
    TranscriptMissing,
    /// Pinning was attempted but failed (I/O error, malformed transcript, etc).
    Failed(String),
    /// The requested cut can't be placed in the provider transcript. The
    /// string is user-facing and becomes the 409 body verbatim.
    PointNotFound(String),
}

/// An adapter (a CLI integration). Trait object stored as `Arc<dyn Adapter>`.
///
/// Optional adapter features are modelled as capability probes + default
/// methods: `has_probe_models()` tells the registry whether to probe or list,
/// and `get_fallback_models()` defaults to no fallback catalog.
pub trait Adapter: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn capabilities(&self) -> AdapterCapabilities;
    /// Whether this adapter's sessions implement `AdapterSession::steer`, for
    /// listings that have no live session to ask. Defaulted to `false`, the
    /// same answer as the session method's default.
    fn supports_steer(&self) -> bool {
        false
    }

    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>>;
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>>;
    fn list_models(&self) -> BoxFuture<'_, Result<Vec<AdapterModel>, AdapterError>>;

    /// `true` when this adapter implements `probe_models`. Default `false`.
    fn has_probe_models(&self) -> bool {
        false
    }
    /// Live-catalog probe (`probeModels?`). `Ok(None)` means "probed, no catalog";
    /// only invoked by the registry when `has_probe_models()` is `true`.
    fn probe_models(
        &self,
        executable_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<Vec<AdapterModel>>, AdapterError>> {
        let _ = executable_path;
        Box::pin(async { Ok(None) })
    }
    /// Synchronous static fallback catalog for spawn-free startup seeding
    /// (`getFallbackModels?`). Default `None`.
    fn get_fallback_models(&self) -> Option<Vec<AdapterModel>> {
        None
    }

    fn configured_model(
        &self,
        _project_path: String,
        _executable_path: Option<String>,
    ) -> BoxFuture<'_, Option<String>> {
        Box::pin(async { None })
    }

    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession>;
    fn kill_all(&self);

    /// Initial transcript path when this adapter has a predictable file layout.
    fn initial_transcript_path(&self, _session_id: &str, _cwd: &str) -> Option<String> {
        None
    }

    /// `getToolCategories?` — default `None`.
    fn get_tool_categories(&self) -> Option<ToolCategories> {
        None
    }
    /// `getContextFiles?(projectPath)` — default `None`.
    fn get_context_files(&self, project_path: &str) -> Option<ContextFiles> {
        let _ = project_path;
        None
    }

    /// `generateTitle?(content, binary)` — a cheap one-shot title from the first
    /// user message via the resolved `<adapterId>.titleBinary` CLI. Adapters
    /// without a cheap, side-effect-free title model omit it (default `Ok(None)`);
    /// callers then keep the deterministic truncated title. Owned `String` args to
    /// match this trait's async-method convention (`send_message`/`set_model`).
    /// The default fires a `debug` log once per attempt — expected today for Codex,
    /// which has no title model — so it reads as "no title model" in the log
    /// instead of being indistinguishable from an adapter that tried and failed.
    fn generate_title(
        &self,
        content: String,
        binary: String,
    ) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        tracing::debug!(
            adapter_id = self.id(),
            reason = "adapter_has_no_title_model",
            "title generation skipped"
        );
        let _ = (content, binary);
        Box::pin(async { Ok(None) })
    }

    /// Absolute on-disk location of the CLI transcript for `session_id`.
    /// `Ok(None)` = the adapter cannot determine the layout — callers MUST treat
    /// it as "unknown" (hide the session, don't flag it), never as "missing".
    /// Owned args for the same async-trait-convention reason as `generate_title`.
    fn locate_transcript(
        &self,
        session_id: String,
        project_path: String,
        session_file_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<TranscriptLocation>, AdapterError>> {
        let _ = (session_id, project_path, session_file_path);
        Box::pin(async { Ok(None) })
    }

    /// `createPlanModeHandler?()` — the adapter's plan-mode action strategy.
    /// `None` = this adapter has no plan-mode strategy; the dispatcher warns and
    /// no-ops rather than failing the permission response.
    fn create_plan_mode_handler(&self) -> Option<Arc<dyn PlanModeActionHandler>> {
        None
    }

    /// Pin a fork's starting point: locate and snapshot whatever the
    /// adapter needs to branch `request.source_session_id`'s conversation
    /// without disturbing it. Default `Unsupported` — adapters with no fork
    /// mechanism need not override this; `ChatManager::fork_chat` treats
    /// `Unsupported` the same as `capabilities().fork == false`.
    fn pin_fork_point(
        &self,
        request: ForkPinRequest,
    ) -> BoxFuture<'_, Result<ForkSource, ForkPinError>> {
        let _ = request;
        Box::pin(async { Err(ForkPinError::Unsupported) })
    }

    /// Report the CLI version the registry's refresh observed, so a
    /// capability that depends on the installed version (Codex's `fork`, gated
    /// on a minimum CLI release) can be computed synchronously from
    /// `capabilities()` without that method itself spawning a process.
    /// `AdapterRegistry::run_refresh` calls this once per refresh, before
    /// `apply_refresh`, on both the primary and the fallback version-detection
    /// path; `None` means the version could not be determined (uninstalled, or
    /// the CLI's `--version` output didn't parse). Default no-op: adapters whose
    /// capabilities never depend on version need not override it.
    fn observe_cli_version(&self, version: Option<&str>) {
        let _ = version;
    }

    /// A human-readable reason `capabilities().fork` is currently `false`,
    /// or `None` when fork is available or the adapter has no
    /// version-gated fork story at all. Surfaced verbatim by the Fork menu item
    /// and the REST route's 422 body — adapter-agnostic on the caller side, so
    /// this is the only place the wording lives. Default `None`.
    fn fork_unavailable_reason(&self) -> Option<String> {
        None
    }

    // Skill/agent/command CRUD and external-session listing are not trait
    // methods: the server calls the concrete adapter crates directly, keyed on
    // the adapter id. The registry + chat-session consumers do not need them.
}
