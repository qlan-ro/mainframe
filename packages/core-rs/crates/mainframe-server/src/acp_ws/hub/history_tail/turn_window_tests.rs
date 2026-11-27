use super::*;

#[tokio::test]
async fn a_different_turn_count_misses_the_saved_tail_without_an_error() {
    let fixture = fixture().await;
    persist(&fixture).await;
    let ctx = restart(&fixture);
    let hub = &ctx.chat.facade_hub;
    let manager = &ctx.chat.chat_manager;
    let mut turns = request(&fixture.chat_id);
    turns.params.as_mut().unwrap()["_meta"]["_mainframe.dev"]["window"] = json!({"turns":10});
    assert!(
        hub.persisted_resume(manager, &turns, options(), None)
            .await
            .is_none(),
        "a window saved for another request is a miss"
    );
    assert!(
        hub.persisted_resume(manager, &request(&fixture.chat_id), options(), None)
            .await
            .is_some(),
        "the saved tail still answers its own request"
    );
    ctx.chat.chat_manager.dispose();
    fixture.ctx.chat.chat_manager.dispose();
}
