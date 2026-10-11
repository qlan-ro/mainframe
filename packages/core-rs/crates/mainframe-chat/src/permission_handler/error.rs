//! The permission handler's error type.

use mainframe_adapter_api::AdapterError;

/// Errors surfaced by permission handling. Strings cross the wire, copied verbatim.
#[derive(Debug, thiserror::Error)]
pub enum PermissionError {
    #[error(transparent)]
    Store(#[from] mainframe_types::seam_error::SeamError),
    /// The chat has no live session to answer the gate on.
    #[error("No session for chat {0}")]
    NoSession(String),
    /// The ACP facade was built without a chat manager to route answers to.
    #[error("chat manager unavailable")]
    ManagerUnavailable,
    #[error(transparent)]
    Adapter(#[from] AdapterError),
}
