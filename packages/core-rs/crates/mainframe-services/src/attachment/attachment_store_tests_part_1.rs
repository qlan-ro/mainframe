use super::*;

fn b64(s: &str) -> String {
    // Encode with the standard alphabet and padding.
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

#[test]
fn sanitize_collapses_disallowed_runs_and_strips_directories() {
    assert_eq!(sanitize_file_name("a b*c**d.txt"), "a b_c_d.txt");
    assert_eq!(sanitize_file_name("***"), "_");
    assert_eq!(sanitize_file_name("   "), "attachment.bin");
    assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
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
    let err = err.unwrap_err();
    assert!(matches!(err, AttachmentError::InvalidChatId(_)));
    assert_eq!(err.to_string(), "Invalid chatId path segment: \"../evil\"");
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
