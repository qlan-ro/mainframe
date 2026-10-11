#[tokio::test]
async fn materializes_image_bytes_and_records_the_path() {
    let (_d, store) = store().await;
    let metas = store
        .save(
            "chat-img-1",
            vec![StoredAttachment {
                name: "shot.png".into(),
                media_type: "image/png".into(),
                size_bytes: 15,
                kind: AttachmentKind::Image,
                data: b64("fake-image-data"),
                original_path: None,
                materialized_path: None,
            }],
        )
        .await
        .unwrap();
    let path = metas[0].materialized_path.as_ref().unwrap();
    let bytes = tokio::fs::read(path).await.unwrap();
    assert_eq!(bytes, b"fake-image-data");
}

#[tokio::test]
async fn stored_image_metadata_carries_the_materialized_path() {
    let (_d, store) = store().await;
    let metas = store
        .save(
            "chat-img-2",
            vec![StoredAttachment {
                name: "shot.png".into(),
                media_type: "image/png".into(),
                size_bytes: 15,
                kind: AttachmentKind::Image,
                data: b64("fake-image-data"),
                original_path: None,
                materialized_path: None,
            }],
        )
        .await
        .unwrap();
    let meta = &metas[0];
    let stored = store.get("chat-img-2", &meta.id).await.unwrap();
    assert_eq!(stored.materialized_path, meta.materialized_path);
}

#[tokio::test]
async fn strips_path_traversal_from_image_file_name() {
    let (dir, store) = store().await;
    let metas = store
        .save(
            "chat-img-3",
            vec![StoredAttachment {
                name: "../../etc/passwd".into(),
                media_type: "image/png".into(),
                size_bytes: 10,
                kind: AttachmentKind::Image,
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
async fn delete_chat_removes_materialized_images() {
    let (_d, store) = store().await;
    let metas = store
        .save(
            "chat-img-4",
            vec![StoredAttachment {
                name: "shot.png".into(),
                media_type: "image/png".into(),
                size_bytes: 15,
                kind: AttachmentKind::Image,
                data: b64("fake-image-data"),
                original_path: None,
                materialized_path: None,
            }],
        )
        .await
        .unwrap();
    let path = metas[0].materialized_path.clone().unwrap();
    store.delete_chat("chat-img-4").await;
    assert!(tokio::fs::metadata(&path).await.is_err());
    assert!(store.list("chat-img-4").await.is_empty());
}
