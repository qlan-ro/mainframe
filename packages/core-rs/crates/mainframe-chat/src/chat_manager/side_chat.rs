//! `ChatManager::open_side_chat`: open or reveal a chat's side chat, seeded
//! from the parent's resolved config. Discard reuses the existing
//! temporary-chat discard path (`discard.rs`); the parent re-sync is shared by
//! both `open_side_chat` and `discard.rs`'s side-chat branch.
use super::*;

/// Whether `chat` is itself a side chat: temporary AND has a parent. No third
/// concept — this is the wire contract's own definition (plan Goal).
pub(super) fn is_side_chat(chat: &Chat) -> bool {
    chat.temporary && chat.parent_chat_id.as_ref().is_some_and(|p| p.is_some())
}

/// `POST /api/chats/{id}/side-chat`'s daemon-side orchestration failures.
#[derive(Debug, PartialEq, thiserror::Error)]
pub enum OpenSideChatError {
    #[error("Chat {0} not found")]
    NotFound(String),
    #[error("Archived chats can't open a side chat")]
    Archived,
    #[error("A side chat can't have its own side chat")]
    ParentIsSideChat,
    #[error("This chat's folder is missing")]
    DirectoryMissing,
    #[error("{0}")]
    InsertFailed(String),
}

impl OpenSideChatError {
    /// The REST status the wire contract assigns this failure.
    pub fn status_code(&self) -> u16 {
        match self {
            OpenSideChatError::NotFound(_) => 404,
            OpenSideChatError::Archived
            | OpenSideChatError::ParentIsSideChat
            | OpenSideChatError::DirectoryMissing => 409,
            OpenSideChatError::InsertFailed(_) => 500,
        }
    }
}

impl ChatManager {
    /// Open (or reveal) `parent_id`'s side chat. Refusals run in a fixed order
    /// and write no row. A parent that already has a side chat reveals it
    /// instead of minting a second one; two concurrent opens converge on the
    /// same row because the DB worker serializes `find_or_create_side_chat`'s
    /// select-then-insert against the partial unique index (migration 30).
    pub async fn open_side_chat(&self, parent_id: &str) -> Result<Chat, OpenSideChatError> {
        let parent = self
            .get_chat(parent_id)
            .ok_or_else(|| OpenSideChatError::NotFound(parent_id.to_string()))?;
        if parent.status == ChatStatus::Archived {
            return Err(OpenSideChatError::Archived);
        }
        if is_side_chat(&parent) {
            return Err(OpenSideChatError::ParentIsSideChat);
        }
        if parent.directory_missing == Some(true) {
            return Err(OpenSideChatError::DirectoryMissing);
        }

        let (side_chat, _created) = self
            .deps
            .chats_find_or_create_side_chat(&parent)
            .map_err(OpenSideChatError::InsertFailed)?;

        self.sync_parent_side_chat_id(parent_id, Some(side_chat.id.clone()));

        Ok(self.get_chat(&side_chat.id).unwrap_or(side_chat))
    }

    /// Sync the parent's active cell (mirrors `rename_chat`'s title sync), then
    /// emit an enriched `ChatUpdated` for the parent. Shared by
    /// `open_side_chat` (side chat id set) and `discard_chat`'s side-chat
    /// branch (side chat id cleared).
    pub(super) fn sync_parent_side_chat_id(&self, parent_id: &str, side_chat_id: Option<String>) {
        if let Some(cell) = self.get_active(parent_id) {
            cell.lock()
                .unwrap_or_else(|e| e.into_inner())
                .chat
                .side_chat_id = side_chat_id;
        }
        if let Some(chat) = self.deps.chats_get(parent_id) {
            self.emit(DaemonEvent::ChatUpdated { chat, reason: None });
        }
    }
}
