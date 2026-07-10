//! Ported from `packages/core/src/plugins/` — the builtin plugin registry, the
//! capability contexts (db / attachments / ui / events / config), the manifest
//! validator, the chat/project service surfaces, and the builtin `todos` plugin.
//!
//! v1 is **builtin-only** (PORTING.md §2.9 / §5): `claude` and `codex` are their
//! own native crates; `todos` lives here. Dynamic third-party JS plugin loading
//! is dropped — the manifest/capability model is preserved so a WASM loader can
//! restore it later, but no JS runtime is ported. This is the one deliberate
//! behavior change; the `manager` load-from-disk path (`loadAll`/`loadPlugin`)
//! is therefore replaced by `load_builtin` only.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod attachment_context;
pub mod config_context;
pub mod context;
pub mod db_context;
pub mod event_bus;
pub mod manager;
pub mod security;
pub mod services;
pub mod todos;
pub mod ui_context;

pub use context::{
    AdapterRegistrar, AttachmentData, AttachmentUpload, ChatService, CreateChatArgs,
    CreateChatResult, EmitSink, NotifyOptions, PluginAttachments, PluginConfig, PluginContext,
    PluginContextDeps, PluginDatabase, PluginEventBus, PluginHostDb, PluginUi, ProjectService,
    build_plugin_context,
};
pub use db_context::PluginDatabaseContext;
pub use mainframe_adapter_api::BoxFuture;
pub use manager::PluginManager;

/// Fallible-operation error for the plugin layer. `Message` and
/// `CapabilityRequired` carry verbatim human strings so the TS `throw new
/// Error(...)` sites round-trip their exact text.
#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// `capabilityGuard(cap)` — thrown when a gated subsystem is used without its
    /// manifest capability. Text matches `context.ts` verbatim.
    #[error("Plugin capability '{0}' is required but not declared in manifest")]
    CapabilityRequired(String),
    #[error("{0}")]
    Message(String),
}

// PORT STATUS: src/plugins/ (crate root barrel)
// confidence: medium
// todos: 1
// notes: builtin-only per §2.9/§5 — dynamic JS load path dropped (manager keeps
// load_builtin only). Behavioral interfaces the types crate deferred
// (PluginContext, PluginEventBus, PluginUIContext, ChatServiceAPI, …) land here
// as Rust traits over BoxFuture (dyn-safe, reusing mainframe-adapter-api). The
// per-plugin SQLite runs on a dedicated actor thread (db_context) mirroring the
// main Db actor's single-connection discipline (CONCURRENCY.tsv db-context row).
// TODO(port): external plugin loading dropped in v1.
