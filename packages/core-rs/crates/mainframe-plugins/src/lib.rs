//! The builtin plugin registry, the capability contexts (db / attachments / ui
//! / events / config), the manifest validator, the chat/project service
//! surfaces, and the builtin `todos` plugin.
//!
//! Plugins are **builtin-only**: `claude` and `codex` are their own native
//! crates; `todos` lives here. There is no dynamic third-party plugin loading
//! and no JS runtime — the manifest/capability model is kept so a WASM loader
//! can add loading later, and the `manager` registers plugins through
//! `load_builtin` only.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod attachment_context;
pub mod context;
pub mod db_context;
pub mod github_port;
mod github_port_guard;
pub mod manager;
pub mod services;
pub mod todos;
pub mod todos_github;
pub mod ui_context;

#[cfg(test)]
mod github_port_tests;

pub use context::{
    AttachmentData, AttachmentUpload, ChatService, CreateChatArgs, CreateChatResult, EmitSink,
    NotifyOptions, PluginAttachments, PluginContext, PluginContextDeps, PluginDatabase,
    PluginHostDb, PluginUi, build_plugin_context,
};
pub use db_context::PluginDatabaseContext;
pub use github_port::{
    CreateIssue, GitHubIssues, GitHubPortError, IssueFieldTimes, IssuePatch, IssueSnapshot,
    IssueState, RepoRef,
};
pub use mainframe_adapter_api::BoxFuture;
pub use manager::PluginManager;

/// Fallible-operation error for the plugin layer. `Message` and
/// `CapabilityRequired` carry verbatim human-readable strings.
#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// Returned when a gated subsystem is used without its manifest
    /// capability.
    #[error("Plugin capability '{0}' is required but not declared in manifest")]
    CapabilityRequired(String),
    #[error("{0}")]
    Message(String),
}

impl From<mainframe_db::DbError> for PluginError {
    fn from(error: mainframe_db::DbError) -> Self {
        match error {
            mainframe_db::DbError::Sqlite(error) => Self::Sqlite(error),
            mainframe_db::DbError::Json(error) => Self::Json(error),
            mainframe_db::DbError::Io(error) => Self::Io(error),
            mainframe_db::DbError::Message(message) => Self::Message(message),
        }
    }
}
