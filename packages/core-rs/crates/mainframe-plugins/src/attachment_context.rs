//! Per-plugin, per-entity attachment storage under `<pluginDir>/attachments`.
//! Each attachment is two files in the entity's directory: `<id>-<safeName>`
//! (the bytes) and `<id>.json` (the metadata record). Entity and attachment
//! ids are caller-supplied path segments and must be single safe identifiers;
//! file names go through the chat attachment store's sanitizer.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use mainframe_services::attachment::sanitize_file_name;
use mainframe_types::base64_data;
use mainframe_types::ids::is_safe_identifier;
use mainframe_types::plugin::PluginAttachmentMeta;
use mainframe_types::time::now_iso8601;
use serde::Serialize;

use crate::PluginError;

/// An attachment upload body.
#[derive(Debug, Clone)]
pub struct AttachmentUpload {
    pub filename: String,
    pub mime_type: String,
    /// Base64-encoded bytes.
    pub data: String,
}

/// A stored attachment: its bytes and metadata record.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentData {
    /// Base64-encoded bytes.
    pub data: String,
    pub meta: PluginAttachmentMeta,
}

/// Filesystem-backed attachment store rooted at `<pluginDir>/attachments`.
pub struct FsAttachmentContext {
    base_dir: PathBuf,
}

impl FsAttachmentContext {
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    /// The entity's directory, or `None` when the id is not a single safe
    /// path segment (so it can never escape the base directory).
    fn entity_dir(&self, id: &str) -> Option<PathBuf> {
        is_safe_identifier(id).then(|| self.base_dir.join(id))
    }

    /// Stores the decoded bytes and their metadata. The recorded size is the
    /// decoded length, not a client-reported figure.
    pub async fn save(
        &self,
        entity_id: &str,
        file: AttachmentUpload,
    ) -> Result<PluginAttachmentMeta, PluginError> {
        let dir = self
            .entity_dir(entity_id)
            .ok_or_else(|| PluginError::InvalidEntityId(entity_id.to_string()))?;
        tokio::fs::create_dir_all(&dir).await?;
        let id = nanoid::nanoid!();
        let safe_name = sanitize_file_name(&file.filename);
        let bytes = base64_data::decode_lenient(&file.data);
        let size_bytes = i64::try_from(bytes.len()).unwrap_or(i64::MAX);
        tokio::fs::write(dir.join(format!("{id}-{safe_name}")), bytes).await?;
        let record = PluginAttachmentMeta {
            id: id.clone(),
            filename: file.filename,
            mime_type: file.mime_type,
            size_bytes,
            created_at: now_iso8601(),
        };
        tokio::fs::write(dir.join(format!("{id}.json")), serde_json::to_vec(&record)?).await?;
        Ok(record)
    }

    /// `None` when the ids are invalid, the attachment does not exist, or its
    /// metadata record is unreadable.
    pub async fn get(
        &self,
        entity_id: &str,
        id: &str,
    ) -> Result<Option<AttachmentData>, PluginError> {
        let Some(dir) = self
            .entity_dir(entity_id)
            .filter(|_| is_safe_identifier(id))
        else {
            return Ok(None);
        };
        let Some(meta_raw) = read_if_exists(&dir.join(format!("{id}.json"))).await? else {
            return Ok(None);
        };
        let meta: PluginAttachmentMeta = match serde_json::from_slice(&meta_raw) {
            Ok(meta) => meta,
            Err(error) => {
                tracing::warn!(entity_id, id, %error, "unreadable plugin attachment metadata");
                return Ok(None);
            }
        };
        let Some(data_file) = find_data_file(&dir, id).await? else {
            return Ok(None);
        };
        let buf = tokio::fs::read(&data_file).await?;
        Ok(Some(AttachmentData {
            data: base64_data::encode(&buf),
            meta,
        }))
    }

    /// Every readable metadata record for the entity, oldest first.
    pub async fn list(&self, entity_id: &str) -> Result<Vec<PluginAttachmentMeta>, PluginError> {
        let Some(dir) = self.entity_dir(entity_id) else {
            return Ok(Vec::new());
        };
        let Some(mut entries) = read_dir_if_exists(&dir).await? else {
            return Ok(Vec::new());
        };
        let mut metas = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_name().to_string_lossy().ends_with(".json") {
                continue;
            }
            let Some(bytes) = read_if_exists(&entry.path()).await? else {
                continue;
            };
            match serde_json::from_slice::<PluginAttachmentMeta>(&bytes) {
                Ok(meta) => metas.push(meta),
                Err(error) => tracing::warn!(
                    path = %entry.path().display(), %error,
                    "skipping unreadable plugin attachment metadata"
                ),
            }
        }
        metas.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        Ok(metas)
    }

    pub async fn delete(&self, entity_id: &str, id: &str) -> Result<(), PluginError> {
        let Some(dir) = self
            .entity_dir(entity_id)
            .filter(|_| is_safe_identifier(id))
        else {
            return Ok(());
        };
        let Some(mut entries) = read_dir_if_exists(&dir).await? else {
            return Ok(());
        };
        let json_name = format!("{id}.json");
        let data_prefix = format!("{id}-");
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if (name == json_name || name.starts_with(&data_prefix))
                && let Err(error) = tokio::fs::remove_file(entry.path()).await
            {
                tracing::warn!(%error, path = %entry.path().display(), "failed to remove attachment context file");
            }
        }
        Ok(())
    }
}

async fn read_if_exists(path: &Path) -> Result<Option<Vec<u8>>, PluginError> {
    match tokio::fs::read(path).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

async fn read_dir_if_exists(dir: &Path) -> Result<Option<tokio::fs::ReadDir>, PluginError> {
    match tokio::fs::read_dir(dir).await {
        Ok(entries) => Ok(Some(entries)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// The data file for `id`: the entry named `<id>-…` that is not the metadata
/// record.
async fn find_data_file(dir: &Path, id: &str) -> Result<Option<PathBuf>, PluginError> {
    let Some(mut entries) = read_dir_if_exists(dir).await? else {
        return Ok(None);
    };
    let prefix = format!("{id}-");
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(&prefix) && !name.ends_with(".json") {
            return Ok(Some(entry.path()));
        }
    }
    Ok(None)
}

#[cfg(test)]
#[path = "attachment_context_tests.rs"]
mod tests;
