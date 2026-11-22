use std::path::{Path, PathBuf};

use mainframe_types::http_status::{HttpStatus, StatusKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    Image,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAttachment {
    pub name: String,
    pub media_type: String,
    pub size_bytes: i64,
    pub kind: AttachmentKind,
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materialized_path: Option<String>,
}

impl StoredAttachment {
    /// The record without its payload, under `id`.
    fn into_meta(self, id: String) -> StoredAttachmentMeta {
        StoredAttachmentMeta {
            id,
            name: self.name,
            media_type: self.media_type,
            size_bytes: self.size_bytes,
            kind: self.kind,
            original_path: self.original_path,
            materialized_path: self.materialized_path,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAttachmentMeta {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub size_bytes: i64,
    pub kind: AttachmentKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materialized_path: Option<String>,
}

/// Fallible-operation error surfaced by `save` (the write path). Read paths
/// (`get`/`list`/`delete_chat`) never return `Err`; they return null or empty
/// results when a read fails.
#[derive(Debug, thiserror::Error)]
pub enum AttachmentError {
    /// A chat id that is not a single safe path segment.
    #[error("Invalid chatId path segment: {0:?}")]
    InvalidChatId(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub struct AttachmentStore {
    base_dir: PathBuf,
}

impl HttpStatus for AttachmentError {
    fn status_kind(&self) -> StatusKind {
        match self {
            Self::InvalidChatId(_) => StatusKind::BadRequest,
            Self::Io(_) | Self::Json(_) => StatusKind::Internal,
        }
    }
}

impl AttachmentStore {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    /// Resolve a chat's attachment dir, rejecting any chatId that is not a single
    /// safe path segment, closing the path-traversal seam.
    fn chat_dir(&self, chat_id: &str) -> Result<PathBuf, AttachmentError> {
        if !mainframe_types::ids::is_safe_identifier(chat_id) {
            return Err(AttachmentError::InvalidChatId(chat_id.to_string()));
        }
        Ok(self.base_dir.join(chat_id))
    }

    pub async fn save(
        &self,
        chat_id: &str,
        attachments: Vec<StoredAttachment>,
    ) -> Result<Vec<StoredAttachmentMeta>, AttachmentError> {
        let dir = self.chat_dir(chat_id)?;
        tokio::fs::create_dir_all(&dir).await?;
        let files_dir = dir.join("files");
        tokio::fs::create_dir_all(&files_dir).await?;

        let mut results = Vec::with_capacity(attachments.len());
        for attachment in attachments {
            let id = nanoid::nanoid!();
            let materialized_path = match self.materialize(&files_dir, &id, &attachment).await {
                Ok(path) => Some(path),
                Err(err) => {
                    tracing::warn!(error = %err,
                        chat_id,
                        name = %attachment.name,
                        "failed to materialize attachment file"
                    );
                    None
                }
            };

            let stored = StoredAttachment {
                materialized_path,
                ..attachment
            };
            tokio::fs::write(dir.join(format!("{id}.json")), serde_json::to_vec(&stored)?).await?;
            results.push(stored.into_meta(id));
        }
        Ok(results)
    }

    async fn materialize(
        &self,
        files_dir: &Path,
        id: &str,
        attachment: &StoredAttachment,
    ) -> Result<String, AttachmentError> {
        let safe_name = sanitize_file_name(&attachment.name);
        let materialized = files_dir.join(format!("{id}-{safe_name}"));
        tokio::fs::write(
            &materialized,
            mainframe_types::base64_data::decode_lenient(&attachment.data),
        )
        .await?;
        Ok(materialized.to_string_lossy().into_owned())
    }

    pub async fn get(&self, chat_id: &str, attachment_id: &str) -> Option<StoredAttachment> {
        // `attachment_id` is a caller-supplied path segment; reject anything that
        // isn't a single safe segment before it can escape the chat dir.
        if !mainframe_types::ids::is_safe_identifier(attachment_id) {
            return None;
        }
        let dir = self.chat_dir(chat_id).ok()?;
        let file_path = dir.join(format!("{attachment_id}.json"));
        let content = tokio::fs::read(&file_path).await.ok()?;
        // expected: attachment not found / malformed
        serde_json::from_slice(&content).ok()
    }

    pub async fn list(&self, chat_id: &str) -> Vec<StoredAttachmentMeta> {
        let Ok(dir) = self.chat_dir(chat_id) else {
            // expected: an invalid chat id has no attachments
            return Vec::new();
        };
        let mut read_dir = match tokio::fs::read_dir(&dir).await {
            Ok(rd) => rd,
            // expected: no attachments for this chat yet, or the dir is unreadable
            Err(_) => return Vec::new(),
        };
        let mut results = Vec::new();
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            let Some(id) = file_name.strip_suffix(".json") else {
                continue;
            };
            let id = id.to_string();
            let Ok(content) = tokio::fs::read(entry.path()).await else {
                continue;
            };
            // expected: a malformed record is skipped
            let Ok(parsed) = serde_json::from_slice::<StoredAttachment>(&content) else {
                continue;
            };
            results.push(parsed.into_meta(id));
        }
        results
    }

    pub async fn delete_chat(&self, chat_id: &str) {
        match self.chat_dir(chat_id) {
            Ok(dir) => {
                if let Err(err) = tokio::fs::remove_dir_all(&dir).await {
                    // A missing directory is already deleted; surface other errors.
                    if err.kind() != std::io::ErrorKind::NotFound {
                        tracing::warn!(error = ?err,
                            chat_id,
                            "failed to delete chat attachments"
                        );
                    }
                }
            }
            Err(err) => {
                tracing::warn!(error = ?err,
                    chat_id,
                    "failed to delete chat attachments"
                );
            }
        }
    }
}

/// The on-disk name for an uploaded file (the record keeps the original): the
/// base name with each run of characters outside ASCII letters, digits and
/// `_.-() ` collapsed to one `_`, trimmed, or `attachment.bin` when nothing
/// is left.
pub fn sanitize_file_name(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    // Replace runs of `[^\w.\-() ]` with a single `_`, then trim.
    let mut out = String::with_capacity(base.len());
    let mut prev_replaced = false;
    for c in base.chars() {
        let allowed = c.is_ascii_alphanumeric()
            || c == '_'
            || c == '.'
            || c == '-'
            || c == '('
            || c == ')'
            || c == ' ';
        if allowed {
            out.push(c);
            prev_replaced = false;
        } else if !prev_replaced {
            out.push('_');
            prev_replaced = true;
        }
    }
    let file = out.trim();
    if file.is_empty() {
        "attachment.bin".to_string()
    } else {
        file.to_string()
    }
}

#[cfg(test)]
#[path = "attachment_store_tests.rs"]
mod tests;
