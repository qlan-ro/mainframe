//! The builtin plugin registry, the capability-gated plugin context (storage,
//! attachments, ui, chat creation, GitHub Issues), and the builtin `todos`
//! plugin with its GitHub sync.
//!
//! Plugins are builtin-only: `claude` and `codex` are their own native crates
//! and register here only for the listing; `todos` lives here. There is no
//! dynamic plugin loading, so `PluginManager::load_builtin` is the only way
//! in.
#![forbid(unsafe_code)]
#![cfg_attr(
    test,
    allow(
        clippy::too_many_lines,
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "Test assertions and scenarios"
    )
)]

pub mod attachment_context;
pub mod chat_service;
pub mod context;
pub mod db_context;
pub mod github_port;
mod github_port_guard;
pub mod manager;
pub mod todos;
mod todos_github;
mod ui_context;

#[cfg(test)]
mod github_port_tests;

pub use context::{
    EmitSink, NotifyOptions, PluginContext, PluginContextDeps, PluginHostDb, PluginUi,
    build_plugin_context,
};
pub use github_port::{
    CreateIssue, GitHubIssues, GitHubPortError, IssueFieldTimes, IssuePatch, IssueSnapshot,
    IssueState, RepoRef,
};
pub use mainframe_adapter_api::BoxFuture;
pub use manager::PluginManager;

/// Fallible-operation error for the plugin layer. Plugin routes answer every
/// one of these with an opaque 500, so no text here is wire contract.
#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// The worker thread that owns a plugin's `data.db` could not take or
    /// answer the request.
    #[error("plugin database worker {0}")]
    Worker(&'static str),
    /// A store failure that is not one of the flattened variants above.
    #[error(transparent)]
    Db(mainframe_db::DbError),
    /// Returned when a gated subsystem is used without its manifest
    /// capability.
    #[error("Plugin capability '{0}' is required but not declared in manifest")]
    CapabilityRequired(String),
    /// An attachment entity id that is not a single safe path segment.
    #[error("Invalid entityId path segment: {0:?}")]
    InvalidEntityId(String),
    /// A row the plugin just wrote could not be read back.
    #[error("{0}")]
    Invariant(&'static str),
}

impl From<mainframe_db::DbError> for PluginError {
    fn from(error: mainframe_db::DbError) -> Self {
        match error {
            mainframe_db::DbError::Sqlite(error) => Self::Sqlite(error),
            mainframe_db::DbError::Json(error) => Self::Json(error),
            mainframe_db::DbError::Io(error) => Self::Io(error),
            other => Self::Db(other),
        }
    }
}
