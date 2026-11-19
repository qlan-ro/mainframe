use super::*;

#[tokio::test]
async fn old_encoded_tail_format_forces_history_reconstruction() {
    let fixture = fixture().await;
    persist(&fixture).await;
    let store = fixture.ctx.chat.facade_hub.history_tails.as_ref().unwrap();
    let mut manifest = store.manifest(&fixture.chat_id).await.unwrap();
    assert_eq!(manifest.version, store::FORMAT_VERSION);
    manifest.version = 1;
    let path = fixture
        .directory
        .path()
        .join("data/tails")
        .join(format!("{}.meta.json", fixture.chat_id));
    tokio::fs::write(path, serde_json::to_vec(&manifest).unwrap())
        .await
        .unwrap();
    let ctx = restart(&fixture);
    let hub = &ctx.chat.facade_hub;
    assert!(
        !hub.initial_history_ready(&ctx.chat.chat_manager, &fixture.chat_id)
            .await
    );
    assert!(
        hub.persisted_resume(
            &ctx.chat.chat_manager,
            &request(&fixture.chat_id),
            options(),
            None
        )
        .await
        .is_none()
    );
    ctx.chat.chat_manager.dispose();
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn store_rejects_mixed_generations_invalid_ids_and_oversized_files() {
    let fixture = fixture().await;
    persist(&fixture).await;
    let store = fixture.ctx.chat.facade_hub.history_tails.as_ref().unwrap();
    assert!(store.manifest("../outside").await.is_none());
    let mut manifest = store.manifest(&fixture.chat_id).await.unwrap();
    manifest.generation = "different".into();
    assert!(store.tail(&manifest).await.is_none());
    let body = fixture
        .directory
        .path()
        .join("data/tails")
        .join(format!("{}.tail.json", fixture.chat_id));
    let file = tokio::fs::File::create(body).await.unwrap();
    file.set_len(8 * 1024 * 1024 + 1).await.unwrap();
    manifest.generation = store.manifest(&fixture.chat_id).await.unwrap().generation;
    assert!(store.tail(&manifest).await.is_none());
    fixture.ctx.chat.chat_manager.dispose();
}
