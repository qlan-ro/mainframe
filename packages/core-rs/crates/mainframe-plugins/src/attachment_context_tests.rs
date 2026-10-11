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
