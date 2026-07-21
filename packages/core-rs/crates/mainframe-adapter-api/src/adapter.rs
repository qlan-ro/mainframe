//! Ported from the *behavioral* half of `packages/types/src/adapter.ts` — the
//! `SessionSink`, `AdapterSession`, and `Adapter` interfaces. The serde DATA half
//! of that same TS file (DTOs, `clampEffortToSupported`, `TUNABLE_FEATURES`) lives
//! in `mainframe-types::adapter`; this module imports those and adds the traits.
//!
//! Trait-object vs generic (per CONCURRENCY.tsv rows 130/93/95): the registry
//! stores `Arc<dyn Adapter>` and `ChatState` holds `Arc<dyn AdapterSession>`, so
//! both are trait objects. Rust async-fn-in-trait is not `dyn`-compatible and the
//! workspace has no `async-trait`, so every async method returns
//! `BoxFuture<'_, ..>` by hand (the same manual pattern already used in
//! `mainframe-services::workspace::session_files`). `SessionSink`'s methods mirror
//! the TS `void` callbacks 1:1 as synchronous fire-and-forget calls: the Rust
//! implementations emit over channels (`broadcast`/`mpsc` sends, non-blocking), so
//! no method needs to return a future.

use std::sync::Arc;

use mainframe_types::adapter::{
    AdapterCapabilities, AdapterModel, AdapterProcess, ContextUsage, ControlRequest,
    ControlResponse, DetectedPr, MessageMetadata, ProviderQuota, SessionOptions, SessionResult,
    SessionSpawnOptions,
};
use mainframe_types::chat::{ChatMessage, MessageContent, ResolvedTuning, TodoItem};
use mainframe_types::context::{ContextFile, SkillFileEntry};
use mainframe_types::display::ToolCategories;
use mainframe_types::settings::ExecutionMode;
use serde::{Deserialize, Serialize};

use crate::{AdapterError, BoxFuture};

/// One inline image attachment for `sendMessage` (`{ mediaType, data }`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    pub media_type: String,
    pub data: String,
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

/// Payload of `SessionSink::on_skill_loaded` — the inline
/// `{ skillName, path, content }` object from the TS interface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSkill {
    pub skill_name: String,
    pub path: String,
    pub content: String,
}

/// The callback surface a live session drives (mirrors the TS `SessionSink`).
/// Every method is synchronous `void` in TS; kept synchronous here (see the
/// module doc). `Send + Sync` so the session's stdout reader task can own an
/// `Arc<dyn SessionSink>`.
pub trait SessionSink: Send + Sync {
    fn on_init(&self, session_id: &str);
    fn on_message(&self, content: Vec<MessageContent>, metadata: Option<MessageMetadata>);
    fn on_tool_result(&self, content: Vec<MessageContent>);
    fn on_permission(&self, request: ControlRequest);
    fn on_result(&self, data: SessionResult);
    fn on_exit(&self, code: Option<i32>);
    fn on_error(&self, error: AdapterError);
    fn on_compact(&self);
    fn on_compact_start(&self);
    fn on_context_usage(&self, usage: ContextUsage);
    fn on_plan_file(&self, file_path: &str);
    fn on_skill_file(&self, entry: SkillFileEntry);
    fn on_queued_processed(&self, uuid: &str);
    fn on_todo_update(&self, todos: Vec<TodoItem>);
    fn on_pr_detected(&self, pr: DetectedPr);
    /// CLI-synthesized feedback text (e.g. unknown-command errors).
    fn on_cli_message(&self, text: &str);
    /// A skill was loaded via slash-command; render a collapsible card.
    fn on_skill_loaded(&self, entry: LoadedSkill);
    /// Inline content blocks from a subagent stream event; each block's
    /// `parentToolUseId` must already equal `parent_tool_use_id`. Implementations
    /// no-op silently if it matches no known tool_use block.
    fn on_subagent_child(&self, parent_tool_use_id: &str, blocks: Vec<MessageContent>);
    /// Non-fatal advisory (`onTrustRequired?`) — optional in TS, default no-op.
    fn on_trust_required(&self, _project_path: &str) {}
    /// Account-wide provider plan quota (`onProviderQuota?`) — optional in TS,
    /// default no-op; no chatId, mirrors `on_context_usage`.
    fn on_provider_quota(&self, _adapter_id: &str, _quota: ProviderQuota) {}
}

/// A live adapter session (mirrors the TS `AdapterSession`). Trait object stored
/// as `Arc<dyn AdapterSession>`; read-only props are getters, everything async is
/// a hand-rolled `BoxFuture`.
pub trait AdapterSession: Send + Sync {
    fn id(&self) -> &str;
    fn adapter_id(&self) -> &str;
    fn project_path(&self) -> &str;
    fn is_spawned(&self) -> bool;
    /// `supportsReplayAck?` — default `false` (adapter consumes the message
    /// synchronously, so the chat-manager never enrolls it in `queuedRefs`).
    fn supports_replay_ack(&self) -> bool {
        false
    }
    /// `lastActivityAt?` — epoch ms of last protocol activity; `None` means the
    /// idle-eviction scanner treats the session as always-active.
    fn last_activity_at(&self) -> Option<i64> {
        None
    }

    fn spawn(
        &self,
        options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>>;
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn get_process_info(&self) -> Option<AdapterProcess>;

    fn send_message(
        &self,
        message: String,
        images: Vec<ImageInput>,
        uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn set_model(&self, model: String) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn set_permission_mode(&self, mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn set_plan_mode(&self, on: bool) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn send_command(
        &self,
        command: String,
        args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>>;
    fn cancel_queued_message(&self, uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>>;
    fn get_context_files(&self) -> ContextFiles;
    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>>;
    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>>;
    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>>;

    /// Stop a running background task by id. Adapters without bg-task support
    /// resolve `{ ok: false, error: "unsupported" }`.
    fn stop_background_task(
        &self,
        task_id: String,
    ) -> BoxFuture<'_, Result<StopBackgroundTaskResult, AdapterError>>;

    /// Apply a fully-resolved tuning to a live session. `applyTuning?` is optional
    /// in TS (callers use `session.applyTuning?.(t)`); default is a no-op.
    fn apply_tuning(&self, tuning: ResolvedTuning) -> BoxFuture<'_, Result<(), AdapterError>> {
        let _ = tuning;
        Box::pin(async { Ok(()) })
    }
}

/// An adapter (a CLI integration). Trait object stored as `Arc<dyn Adapter>`.
///
/// The optional TS methods that gate on `typeof adapter.X === 'function'` are
/// modelled as capability probes + default methods: `has_probe_models()` mirrors
/// `typeof adapter.probeModels === 'function'` (the registry uses it to choose
/// probe-vs-list), and `get_fallback_models()` mirrors `adapter.getFallbackModels?.()`.
pub trait Adapter: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn capabilities(&self) -> AdapterCapabilities;

    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>>;
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>>;
    fn list_models(&self) -> BoxFuture<'_, Result<Vec<AdapterModel>, AdapterError>>;

    /// `true` when this adapter implements `probe_models` (mirrors the TS
    /// `typeof adapter.probeModels === 'function'` check). Default `false`.
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

    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession>;
    fn kill_all(&self);

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
    fn generate_title(
        &self,
        content: String,
        binary: String,
    ) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        let _ = (content, binary);
        Box::pin(async { Ok(None) })
    }

    /// `isTranscriptPresent?(sessionId, projectPath, sessionFilePath?)` — whether
    /// the CLI's transcript for `session_id` still exists on disk. `Ok(None)` means
    /// presence cannot be determined; callers MUST treat it as "don't flag". Owned
    /// args for the same async-trait-convention reason as `generate_title`.
    fn is_transcript_present(
        &self,
        session_id: String,
        project_path: String,
        session_file_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<bool>, AdapterError>> {
        let _ = (session_id, project_path, session_file_path);
        Box::pin(async { Ok(None) })
    }

    // TODO(port): the optional skill/agent/command/external-session CRUD methods
    // and `createPlanModeHandler?` from adapter.ts are deferred to the phase that
    // ports the concrete claude/codex adapters and their routes — their default
    // wire semantics (unsupported vs empty) must be pinned against those callers,
    // not guessed here. The registry + chat-session consumers do not need them.
}

// PORT STATUS: behavioral half of packages/types/src/adapter.ts (Adapter/
// AdapterSession/SessionSink traits)
// confidence: high
// todos: 1 (skill/agent/command/external-session CRUD + createPlanModeHandler,
//   deferred to the concrete-adapter phase — see the TODO above)
// notes: Main catch-up (#424/#430) adds two OPTIONAL Adapter methods with default
// `Ok(None)` bodies so existing adapters keep compiling and each concrete adapter
// (Wave 1) overrides: generate_title(content, binary) and is_transcript_present(
// session_id, project_path, session_file_path). Owned `String` params (not &str)
// to stay consistent with this trait's async BoxFuture methods; `None` return =
// "unsupported / cannot determine — don't flag".
