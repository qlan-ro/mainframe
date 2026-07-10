//! Ported from `packages/core/src/plugins/attachment-context.ts`.
//!
//! Per-plugin, per-entity attachment storage under `<pluginDir>/attachments`.
//! Each attachment is two files in the entity's directory: `<id>-<safeName>`
//! (the bytes) and `<id>.json` (the metadata record). No `base64` crate is in
//! the §8 allowlist, so encode/decode are hand-rolled to mirror
//! `Buffer.from(data, 'base64')` / `buf.toString('base64')`.

use std::path::{Path, PathBuf};

use mainframe_adapter_api::BoxFuture;
use mainframe_runtime::time::now_iso8601;
use mainframe_types::plugin::PluginAttachmentMeta;

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
                decode_base64(&file.data),
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
                data: encode_base64(&buf),
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

/// Lenient base64 decoder mirroring `Buffer.from(data, 'base64')` (skips invalid
/// characters rather than throwing).
fn decode_base64(input: &str) -> Vec<u8> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::new();
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for &c in input.as_bytes() {
        if c == b'=' {
            break;
        }
        let Some(v) = val(c) else {
            continue;
        };
        buf = (buf << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    out
}

/// Standard-alphabet base64 encoder with padding, mirroring
/// `buf.toString('base64')`.
fn encode_base64(bytes: &[u8]) -> String {
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(ALPHA[((n >> 18) & 63) as usize] as char);
        out.push(ALPHA[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHA[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHA[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
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
                    data: encode_base64(b"hello"),
                    size_bytes: 5,
                },
            )
            .await
            .unwrap();
        assert_eq!(meta.filename, "notes.txt");

        let list = ctx.list("todo-1").await.unwrap();
        assert_eq!(list.len(), 1);

        let fetched = ctx.get("todo-1", &meta.id).await.unwrap().unwrap();
        assert_eq!(decode_base64(&fetched.data), b"hello");

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

// PORT STATUS: src/plugins/attachment-context.ts
// confidence: high
// todos: 0
// notes: two-file layout (`<id>-<safeName>` + `<id>.json`) preserved; async
// node:fs/promises → tokio::fs. sanitize mirrors the `[\w.\-() ]` allow-class +
// `attachment.bin` fallback. base64 hand-rolled (no crate in §8) like the main
// AttachmentStore. get/list/delete swallow missing-dir/malformed-file exactly as
// the TS `catch` blocks (return None/[]/noop).
