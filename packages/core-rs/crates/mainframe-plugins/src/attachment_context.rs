//! Per-plugin, per-entity attachment storage under `<pluginDir>/attachments`.
//! Each attachment is two files in the entity's directory: `<id>-<safeName>`
//! (the bytes) and `<id>.json` (the metadata record). Attachment data uses
//! the shared standard base64 codec with the historical lenient decoder.

use std::path::{Path, PathBuf};

use mainframe_adapter_api::BoxFuture;
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

    /// `entityDir(id)` — `join(baseDir, basename(id))` (basename guards against
    /// path traversal in a caller-supplied id).
    fn entity_dir(&self, id: &str) -> PathBuf {
        self.base_dir.join(basename(id))
    }
}

impl PluginAttachments for FsAttachmentContext {
    fn save(
        &self,
        entity_id: &str,
        file: AttachmentUpload,
    ) -> BoxFuture<'_, Result<PluginAttachmentMeta, PluginError>> {
        let dir = self.entity_dir(entity_id);
        Box::pin(async move {
            tokio::fs::create_dir_all(&dir).await?;
            let id = nanoid::nanoid!();
            let safe_name = sanitize(&file.filename);
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
        let id = id.to_string();
        Box::pin(async move {
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
        let id = id.to_string();
        Box::pin(async move {
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

/// Last path component (`basename`), falling back to the input when it has none.
fn basename(name: &str) -> String {
    Path::new(name)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string())
}

/// `basename(name).replace(/[^\w.\-() ]+/g, '_').trim()` with an
/// `attachment.bin` fallback for an empty result.
fn sanitize(name: &str) -> String {
    let base = basename(name);
    let mut out = String::with_capacity(base.len());
    let mut in_run = false;
    for ch in base.chars() {
        if is_allowed(ch) {
            out.push(ch);
            in_run = false;
        } else if !in_run {
            out.push('_');
            in_run = true;
        }
    }
    let trimmed = out.trim();
    if trimmed.is_empty() {
        "attachment.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

/// The `[\w.\-() ]` character class: word chars, `.`, `-`, `(`, `)`, space.
fn is_allowed(ch: char) -> bool {
    ch.is_alphanumeric() || matches!(ch, '_' | '.' | '-' | '(' | ')' | ' ')
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

    #[tokio::test]
    async fn save_list_get_delete_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = FsAttachmentContext::new(dir.path().join("attachments"));
        let meta = ctx
            .save(
                "todo-1",
                AttachmentUpload {
                    filename: "notes.txt".into(),
                    mime_type: "text/plain".into(),
                    data: mainframe_types::base64_data::encode(b"hello"),
                    size_bytes: 5,
                },
            )
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
        let meta = ctx
            .save(
                "todo-1",
                AttachmentUpload {
                    filename: "empty.txt".into(),
                    mime_type: "application/octet-stream".into(),
                    data: String::new(),
                    size_bytes: 0,
                },
            )
            .await
            .unwrap();
        assert_eq!(meta.size_bytes, 0);
    }

    #[test]
    fn sanitize_replaces_disallowed_runs() {
        // A run of disallowed chars collapses to a single `_`.
        assert_eq!(sanitize("a b*c**d.txt"), "a b_c_d.txt");
        // Non-empty result (even a bare `_`) is kept; only an empty trim falls back.
        assert_eq!(sanitize("***"), "_");
        assert_eq!(sanitize("   "), "attachment.bin");
        // basename() runs first, so directory parts are stripped.
        assert_eq!(sanitize("../../etc/passwd"), "passwd");
    }
}
