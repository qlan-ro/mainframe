//! Ported from `src/attachment/attachment-store.ts`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// A single safe path segment — matches nanoid's alphabet; rejects `..`, `/`, etc.
fn is_safe_segment(s: &str) -> bool {
    // /^[A-Za-z0-9_-]+$/
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

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
/// (`get`/`list`/`delete_chat`) never return `Err` — they mirror the TS
/// swallow-to-null/empty behavior.
#[derive(Debug, thiserror::Error)]
pub enum AttachmentError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub struct AttachmentStore {
    base_dir: PathBuf,
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
        if !is_safe_segment(chat_id) {
            return Err(AttachmentError::Message(format!(
                "Invalid chatId path segment: {chat_id:?}"
            )));
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
            let mut materialized_path = attachment.materialized_path.clone();
            if attachment.kind == AttachmentKind::File {
                match self.materialize_file(&files_dir, &id, &attachment).await {
                    Ok(path) => materialized_path = Some(path),
                    Err(err) => {
                        tracing::warn!(
                            module = "attachment-store",
                            ?err,
                            chat_id,
                            name = %attachment.name,
                            "failed to materialize attachment file"
                        );
                        materialized_path = None;
                    }
                }
            }

            let stored = StoredAttachment {
                materialized_path: materialized_path.clone(),
                ..attachment.clone()
            };
            tokio::fs::write(dir.join(format!("{id}.json")), serde_json::to_vec(&stored)?).await?;

            results.push(StoredAttachmentMeta {
                id,
                name: attachment.name,
                media_type: attachment.media_type,
                size_bytes: attachment.size_bytes,
                kind: attachment.kind,
                original_path: attachment.original_path,
                materialized_path,
            });
        }
        Ok(results)
    }

    async fn materialize_file(
        &self,
        files_dir: &Path,
        id: &str,
        attachment: &StoredAttachment,
    ) -> Result<String, AttachmentError> {
        let safe_name = sanitize_file_name(&attachment.name);
        let materialized = files_dir.join(format!("{id}-{safe_name}"));
        tokio::fs::write(&materialized, decode_base64(&attachment.data)).await?;
        Ok(materialized.to_string_lossy().into_owned())
    }

    pub async fn get(&self, chat_id: &str, attachment_id: &str) -> Option<StoredAttachment> {
        // `attachment_id` is a caller-supplied path segment; reject anything that
        // isn't a single safe segment before it can escape the chat dir.
        if !is_safe_segment(attachment_id) {
            return None;
        }
        let dir = self.chat_dir(chat_id).ok()?;
        let file_path = dir.join(format!("{attachment_id}.json"));
        let content = tokio::fs::read(&file_path).await.ok()?;
        // expected: attachment not found / malformed
        serde_json::from_slice(&content).ok()
    }

    pub async fn list(&self, chat_id: &str) -> Vec<StoredAttachmentMeta> {
        let dir = match self.chat_dir(chat_id) {
            Ok(dir) if tokio::fs::metadata(&dir).await.is_ok() => dir,
            // expected: no attachments for this chat (invalid id or missing dir)
            _ => return Vec::new(),
        };
        let mut read_dir = match tokio::fs::read_dir(&dir).await {
            Ok(rd) => rd,
            // expected: attachment dir not readable
            Err(_) => return Vec::new(),
        };
        let mut results = Vec::new();
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if !file_name.ends_with(".json") {
                continue;
            }
            let id = file_name.trim_end_matches(".json").to_string();
            let Ok(content) = tokio::fs::read(entry.path()).await else {
                continue;
            };
            let parsed: StoredAttachment = match serde_json::from_slice(&content) {
                Ok(p) => p,
                // expected: attachment metadata missing or malformed
                Err(_) => continue,
            };
            results.push(StoredAttachmentMeta {
                id,
                name: parsed.name,
                media_type: parsed.media_type,
                size_bytes: parsed.size_bytes,
                kind: parsed.kind,
                original_path: parsed.original_path,
                materialized_path: parsed.materialized_path,
            });
        }
        results
    }

    pub async fn delete_chat(&self, chat_id: &str) {
        match self.chat_dir(chat_id) {
            Ok(dir) => {
                if let Err(err) = tokio::fs::remove_dir_all(&dir).await {
                    // `rm` with force ignores a missing dir; mirror that by
                    // ignoring NotFound, but surface anything else.
                    if err.kind() != std::io::ErrorKind::NotFound {
                        tracing::warn!(
                            module = "attachment-store",
                            ?err,
                            chat_id,
                            "failed to delete chat attachments"
                        );
                    }
                }
            }
            Err(err) => {
                tracing::warn!(
                    module = "attachment-store",
                    ?err,
                    chat_id,
                    "failed to delete chat attachments"
                );
            }
        }
    }
}

fn sanitize_file_name(name: &str) -> String {
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
    let file = out.trim().to_string();
    if !file.is_empty() {
        file
    } else {
        "attachment.bin".to_string()
    }
}

/// Lenient base64 decoder mirroring `Buffer.from(data, 'base64')` (which skips
/// invalid characters rather than throwing). No `base64` crate is in the §8
/// allowlist, so it is hand-rolled.
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
            continue; // skip whitespace / invalid chars (Node is lenient)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn b64(s: &str) -> String {
        // Encode with the standard alphabet + padding (test helper mirroring
        // Buffer.from(x).toString('base64')).
        const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let bytes = s.as_bytes();
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

    async fn store() -> (tempfile::TempDir, AttachmentStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = AttachmentStore::new(dir.path());
        (dir, store)
    }

    #[tokio::test]
    async fn saves_an_image_and_retrieves_it_by_id() {
        let (_d, store) = store().await;
        let metas = store
            .save(
                "chat-1",
                vec![StoredAttachment {
                    name: "photo.png".into(),
                    media_type: "image/png".into(),
                    size_bytes: 100,
                    kind: AttachmentKind::Image,
                    data: b64("fake-image-data"),
                    original_path: None,
                    materialized_path: None,
                }],
            )
            .await
            .unwrap();
        let meta = &metas[0];
        assert_eq!(meta.name, "photo.png");
        assert_eq!(meta.kind, AttachmentKind::Image);

        let retrieved = store.get("chat-1", &meta.id).await.unwrap();
        assert_eq!(retrieved.name, "photo.png");
        assert_eq!(retrieved.data, b64("fake-image-data"));
    }

    #[tokio::test]
    async fn returns_none_for_non_existent_attachment() {
        let (_d, store) = store().await;
        assert!(store.get("chat-1", "nonexistent-id").await.is_none());
    }

    #[tokio::test]
    async fn list_returns_empty_for_unknown_chat() {
        let (_d, store) = store().await;
        assert!(store.list("unknown-chat").await.is_empty());
    }

    #[tokio::test]
    async fn lists_all_attachments_for_a_chat() {
        let (_d, store) = store().await;
        store
            .save(
                "chat-2",
                vec![
                    StoredAttachment {
                        name: "a.png".into(),
                        media_type: "image/png".into(),
                        size_bytes: 10,
                        kind: AttachmentKind::Image,
                        data: String::new(),
                        original_path: None,
                        materialized_path: None,
                    },
                    StoredAttachment {
                        name: "b.png".into(),
                        media_type: "image/png".into(),
                        size_bytes: 20,
                        kind: AttachmentKind::Image,
                        data: String::new(),
                        original_path: None,
                        materialized_path: None,
                    },
                ],
            )
            .await
            .unwrap();
        let list = store.list("chat-2").await;
        assert_eq!(list.len(), 2);
        let names: Vec<&str> = list.iter().map(|a| a.name.as_str()).collect();
        assert!(names.contains(&"a.png"));
        assert!(names.contains(&"b.png"));
    }

    #[tokio::test]
    async fn delete_chat_removes_all_attachments() {
        let (_d, store) = store().await;
        store
            .save(
                "chat-3",
                vec![StoredAttachment {
                    name: "c.png".into(),
                    media_type: "image/png".into(),
                    size_bytes: 10,
                    kind: AttachmentKind::Image,
                    data: String::new(),
                    original_path: None,
                    materialized_path: None,
                }],
            )
            .await
            .unwrap();
        store.delete_chat("chat-3").await;
        assert!(store.list("chat-3").await.is_empty());
    }

    #[tokio::test]
    async fn delete_chat_does_not_throw_when_dir_missing() {
        let (_d, store) = store().await;
        store.delete_chat("nonexistent-chat").await; // must not panic
    }

    #[tokio::test]
    async fn strips_path_traversal_from_file_name() {
        let (dir, store) = store().await;
        let metas = store
            .save(
                "chat-4",
                vec![StoredAttachment {
                    name: "../../etc/passwd".into(),
                    media_type: "text/plain".into(),
                    size_bytes: 10,
                    kind: AttachmentKind::File,
                    data: b64("data"),
                    original_path: None,
                    materialized_path: None,
                }],
            )
            .await
            .unwrap();
        let mp = metas[0].materialized_path.as_ref().unwrap();
        assert!(!mp.contains(".."));
        assert!(mp.contains(&dir.path().to_string_lossy().into_owned()));
    }

    #[tokio::test]
    async fn empty_after_sanitize_falls_back_to_attachment_bin() {
        let (_d, store) = store().await;
        let metas = store
            .save(
                "chat-5",
                vec![StoredAttachment {
                    name: "   ".into(),
                    media_type: "text/plain".into(),
                    size_bytes: 5,
                    kind: AttachmentKind::File,
                    data: b64("hello"),
                    original_path: None,
                    materialized_path: None,
                }],
            )
            .await
            .unwrap();
        assert!(
            metas[0]
                .materialized_path
                .as_ref()
                .unwrap()
                .ends_with("attachment.bin")
        );
    }

    #[tokio::test]
    async fn rejects_traversal_chat_id_on_save() {
        let (_d, store) = store().await;
        let err = store
            .save(
                "../evil",
                vec![StoredAttachment {
                    name: "x.txt".into(),
                    media_type: "text/plain".into(),
                    size_bytes: 1,
                    kind: AttachmentKind::File,
                    data: String::new(),
                    original_path: None,
                    materialized_path: None,
                }],
            )
            .await;
        assert!(matches!(err, Err(AttachmentError::Message(m)) if m.contains("Invalid chatId")));
    }

    #[tokio::test]
    async fn returns_none_empty_for_traversal_chat_id_on_read_paths() {
        let (_d, store) = store().await;
        assert!(store.get("../../etc", "passwd").await.is_none());
        assert!(store.list("../evil").await.is_empty());
        store.delete_chat("../evil").await; // must not panic
    }

    #[tokio::test]
    async fn accepts_normal_nanoid_style_chat_ids() {
        let (_d, store) = store().await;
        let metas = store
            .save(
                "aB3_x-Yz",
                vec![StoredAttachment {
                    name: "a.png".into(),
                    media_type: "image/png".into(),
                    size_bytes: 1,
                    kind: AttachmentKind::Image,
                    data: String::new(),
                    original_path: None,
                    materialized_path: None,
                }],
            )
            .await
            .unwrap();
        assert_eq!(metas.len(), 1);
    }

    #[tokio::test]
    async fn rejects_traversal_attachment_id_on_get() {
        let (_d, store) = store().await;
        store
            .save(
                "chat-victim",
                vec![StoredAttachment {
                    name: "s.txt".into(),
                    media_type: "text/plain".into(),
                    size_bytes: 1,
                    kind: AttachmentKind::File,
                    data: String::new(),
                    original_path: None,
                    materialized_path: None,
                }],
            )
            .await
            .unwrap();
        assert!(
            store
                .get("chat-a", "../chat-victim/some-id")
                .await
                .is_none()
        );
        assert!(store.get("chat-a", "..%2Fchat-victim").await.is_none());
    }
}

// PORT STATUS: src/attachment/attachment-store.ts (159 lines)
// confidence: high
// todos: 0
// notes: async fs via tokio::fs (Promise.all → sequential awaits, order preserved).
// SAFE_SEGMENT regex → is_safe_segment byte check; nanoid! for ids (same alphabet).
// The .json blob is the StoredAttachment with materializedPath overridden
// (serde camelCase + skip_serializing_if None mirrors JSON.stringify omitting
// undefined). delete_chat ignores NotFound to mirror `rm {force:true}`; other
// errors log the same warn. base64 decode is hand-rolled (no base64 crate in the
// §8 allowlist) and lenient like Buffer.from. size_bytes is i64.
