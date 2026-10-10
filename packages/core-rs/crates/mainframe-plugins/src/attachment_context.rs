//! Per-plugin, per-entity attachment storage under `<pluginDir>/attachments`.
//! Each attachment is two files in the entity's directory: `<id>-<safeName>`
//! (the bytes) and `<id>.json` (the metadata record). Entity and attachment
//! ids are caller-supplied path segments and must be single safe identifiers;
//! file names go through the chat attachment store's sanitizer.

use std::path::{Path, PathBuf};

use mainframe_adapter_api::BoxFuture;
use mainframe_services::attachment::sanitize_file_name;
use mainframe_types::ids::is_safe_identifier;
use mainframe_types::plugin::PluginAttachmentMeta;
use mainframe_types::time::now_iso8601;

use crate::PluginError;
use crate::context::{AttachmentData, AttachmentUpload, PluginAttachments};

/// Filesystem-backed attachment context rooted at `<pluginDir>/attachments`.
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
}

impl PluginAttachments for FsAttachmentContext {
    fn save(
        &self,
        entity_id: &str,
        file: AttachmentUpload,
    ) -> BoxFuture<'_, Result<PluginAttachmentMeta, PluginError>> {
        let dir = self.entity_dir(entity_id);
        let entity_id = entity_id.to_string();
        Box::pin(async move {
            let dir = dir.ok_or_else(|| {
                PluginError::Message(format!("Invalid entityId path segment: {entity_id:?}"))
            })?;
            tokio::fs::create_dir_all(&dir).await?;
            let id = nanoid::nanoid!();
            let safe_name = sanitize_file_name(&file.filename);
            tokio::fs::write(
                dir.join(format!("{id}-{safe_name}")),
                mainframe_types::base64_data::decode_lenient(&file.data),
            )
            .await?;
            let record = PluginAttachmentMeta {
                id: id.clone(),
                filename: file.filename,
                mime_type: file.mime_type,
                size_bytes: file.size_bytes,
                created_at: now_iso8601(),
            };
            tokio::fs::write(dir.join(format!("{id}.json")), serde_json::to_vec(&record)?).await?;
            Ok(record)
        })
    }

    fn get(
        &self,
        entity_id: &str,
        id: &str,
    ) -> BoxFuture<'_, Result<Option<AttachmentData>, PluginError>> {
        let dir = self.entity_dir(entity_id);
        let id = is_safe_identifier(id).then(|| id.to_string());
        Box::pin(async move {
            let (Some(dir), Some(id)) = (dir, id) else {
                return Ok(None);
            };
            let meta_raw = match tokio::fs::read(dir.join(format!("{id}.json"))).await {
                Ok(bytes) => bytes,
                // expected: attachment dir or file does not exist
                Err(_) => return Ok(None),
            };
            let meta: PluginAttachmentMeta = match serde_json::from_slice(&meta_raw) {
                Ok(meta) => meta,
                Err(_) => return Ok(None),
            };
            let Some(data_file) = find_data_file(&dir, &id).await else {
                return Ok(None);
            };
            let buf = tokio::fs::read(&data_file).await?;
            Ok(Some(AttachmentData {
                data: mainframe_types::base64_data::encode(&buf),
                meta,
            }))
        })
    }

    fn list(
        &self,
        entity_id: &str,
    ) -> BoxFuture<'_, Result<Vec<PluginAttachmentMeta>, PluginError>> {
        let dir = self.entity_dir(entity_id);
        Box::pin(async move {
            let Some(dir) = dir else {
                return Ok(Vec::new());
            };
            let mut entries = match tokio::fs::read_dir(&dir).await {
                Ok(entries) => entries,
                Err(_) => return Ok(Vec::new()),
            };
            let mut metas = Vec::new();
            while let Some(entry) = entries.next_entry().await? {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if !name.ends_with(".json") {
                    continue;
                }
                match tokio::fs::read(entry.path()).await {
                    Ok(bytes) => {
                        if let Ok(meta) = serde_json::from_slice::<PluginAttachmentMeta>(&bytes) {
                            metas.push(meta);
                        }
                        // expected: metadata file missing or malformed → skip
                    }
                    Err(_) => continue,
                }
            }
            Ok(metas)
        })
    }

    fn delete(&self, entity_id: &str, id: &str) -> BoxFuture<'_, Result<(), PluginError>> {
        let dir = self.entity_dir(entity_id);
        let id = is_safe_identifier(id).then(|| id.to_string());
        Box::pin(async move {
            let (Some(dir), Some(id)) = (dir, id) else {
                return Ok(());
            };
            let mut entries = match tokio::fs::read_dir(&dir).await {
                Ok(entries) => entries,
                // directory may not exist; nothing to delete
                Err(_) => return Ok(()),
            };
            let json_name = format!("{id}.json");
            let data_prefix = format!("{id}-");
            while let Some(entry) = entries.next_entry().await? {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name == json_name || name.starts_with(&data_prefix) {
                    let _ = tokio::fs::remove_file(entry.path()).await;
                }
            }
            Ok(())
        })
    }
}

/// Find the data file for `id`: `startsWith('<id>-') && !endsWith('.json')`.
async fn find_data_file(dir: &Path, id: &str) -> Option<PathBuf> {
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    let prefix = format!("{id}-");
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(&prefix) && !name.ends_with(".json") {
            return Some(entry.path());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upload(filename: &str, bytes: &[u8]) -> AttachmentUpload {
        AttachmentUpload {
            filename: filename.into(),
            mime_type: "application/octet-stream".into(),
            data: mainframe_types::base64_data::encode(bytes),
            size_bytes: bytes.len() as i64,
        }
    }

    #[tokio::test]
    async fn save_list_get_delete_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = FsAttachmentContext::new(dir.path().join("attachments"));
        let meta = ctx
            .save("todo-1", upload("notes.txt", b"hello"))
            .await
            .unwrap();
        assert_eq!(meta.filename, "notes.txt");

        let list = ctx.list("todo-1").await.unwrap();
        assert_eq!(list.len(), 1);

        let fetched = ctx.get("todo-1", &meta.id).await.unwrap().unwrap();
        assert_eq!(
            mainframe_types::base64_data::decode_lenient(&fetched.data),
            b"hello"
        );

        ctx.delete("todo-1", &meta.id).await.unwrap();
        assert!(ctx.list("todo-1").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn zero_byte_file_saves() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = FsAttachmentContext::new(dir.path().join("attachments"));
        let meta = ctx.save("todo-1", upload("empty.txt", b"")).await.unwrap();
        assert_eq!(meta.size_bytes, 0);
    }

    /// The uploaded file name is sanitized on disk but kept verbatim in the record.
    #[tokio::test]
    async fn file_names_are_sanitized_on_disk_only() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("attachments");
        let ctx = FsAttachmentContext::new(&base);
        let meta = ctx
            .save("todo-1", upload("../../etc/pass wd*.txt", b"x"))
            .await
            .unwrap();
        assert_eq!(meta.filename, "../../etc/pass wd*.txt");
        assert!(
            base.join("todo-1")
                .join(format!("{}-pass wd_.txt", meta.id))
                .exists()
        );
        assert!(!dir.path().join("etc").exists());
    }

    /// Entity and attachment ids that are not single safe segments never
    /// touch the filesystem: writes fail, reads are empty, deletes are no-ops.
    #[tokio::test]
    async fn traversal_ids_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("attachments");
        let ctx = FsAttachmentContext::new(&base);
        let kept = ctx.save("todo-1", upload("a.txt", b"a")).await.unwrap();

        let err = ctx
            .save("../escape", upload("a.txt", b"a"))
            .await
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "Invalid entityId path segment: \"../escape\""
        );
        assert!(!dir.path().join("escape").exists());

        assert!(ctx.list("../todo-1").await.unwrap().is_empty());
        assert!(ctx.get("todo-1", "../todo-1/x").await.unwrap().is_none());
        assert!(ctx.get("todo-1/..", &kept.id).await.unwrap().is_none());
        ctx.delete("todo-1", "..").await.unwrap();
        ctx.delete("..", &kept.id).await.unwrap();
        assert_eq!(ctx.list("todo-1").await.unwrap().len(), 1);
    }
}
