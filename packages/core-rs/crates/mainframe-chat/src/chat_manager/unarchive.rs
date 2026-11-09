//! `ChatManager::unarchive_native_session`: the remedy the client offers when a
//! send fails with `AdapterError::NativeSessionArchived` (a Codex thread
//! archived in the Codex app). It asks the chat's adapter to unarchive the
//! chat's native session; the client then retries the failed send.
use super::*;
use mainframe_types::http_status::{HttpStatus, StatusKind};

/// `POST /api/chats/{id}/native-session/unarchive` failures.
#[derive(Debug, thiserror::Error)]
pub enum UnarchiveNativeSessionError {
    #[error("Chat {0} not found")]
    NotFound(String),
    /// The chat never started a provider session, so there is nothing to
    /// unarchive.
    #[error("This chat has no provider session to unarchive")]
    NoNativeSession,
    #[error(transparent)]
    Adapter(#[from] AdapterError),
}

impl HttpStatus for UnarchiveNativeSessionError {
    fn status_kind(&self) -> StatusKind {
        match self {
            Self::NotFound(_) => StatusKind::NotFound,
            Self::NoNativeSession => StatusKind::Conflict,
            Self::Adapter(AdapterError::Unsupported(_)) => StatusKind::Conflict,
            Self::Adapter(_) => StatusKind::Unavailable,
        }
    }
}

impl ChatManager {
    pub async fn unarchive_native_session(
        &self,
        chat_id: &str,
    ) -> Result<(), UnarchiveNativeSessionError> {
        let not_found = || UnarchiveNativeSessionError::NotFound(chat_id.to_string());
        let chat = self.get_chat(chat_id).ok_or_else(not_found)?;
        let session_id = chat
            .vendor_session_id
            .clone()
            .filter(|id| !id.is_empty())
            .ok_or(UnarchiveNativeSessionError::NoNativeSession)?;
        let project_path = self
            .shared
            .deps
            .projects_get_path(&chat.project_id)
            .ok_or_else(not_found)?;
        let cwd = chat.worktree_path.clone().unwrap_or(project_path);
        self.shared
            .deps
            .unarchive_native_session(&chat.adapter_id, &session_id, &cwd)
            .await
            .inspect_err(
                |err| tracing::warn!(chat_id, error = %err, "native session unarchive failed"),
            )?;
        tracing::info!(chat_id, "native session unarchived");
        Ok(())
    }
}
