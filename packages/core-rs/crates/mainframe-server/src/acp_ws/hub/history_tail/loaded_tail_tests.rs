//! The tail written from a history loaded in full behind a reply answered
//! from adapter pages (`FacadeHub::persist_loaded_tail`).
use super::*;

#[tokio::test]
async fn a_history_loaded_behind_a_paged_reply_becomes_the_tail_the_next_start_serves() {
    let fixture = fixture().await;
    let manager = fixture.ctx.chat.chat_manager.clone();
    let request = request(&fixture.chat_id);
    // A reply from adapter pages stores nothing; the full load behind it does.
    manager.load_chat(&fixture.chat_id).await;
    fixture
        .ctx
        .chat
        .facade_hub
        .persist_loaded_tail(manager.clone(), request.clone(), options())
        .await;
    let port = ManagerPorts::new(Some(manager.clone()));
    let (_, full) =
        mainframe_acp::dispatch_resume_with(request.clone(), &port, None, options()).await;

    let ctx = restart(&fixture);
    let hub = &ctx.chat.facade_hub;
    assert!(
        hub.initial_history_ready(&ctx.chat.chat_manager, &fixture.chat_id)
            .await
    );
    let (_, cached) = hub
        .persisted_resume(&ctx.chat.chat_manager, &request, options(), None)
        .await
        .expect("the next start serves the stored tail");
    assert_eq!(
        serde_json::to_value(cached.updates).unwrap(),
        serde_json::to_value(full.updates).unwrap(),
        "the tail is what a resume over the whole history sends"
    );
    ctx.chat.chat_manager.dispose();
    fixture.ctx.chat.chat_manager.dispose();
}

#[tokio::test]
async fn no_tail_is_stored_before_the_history_is_complete() {
    let fixture = fixture().await;
    let manager = fixture.ctx.chat.chat_manager.clone();

    fixture
        .ctx
        .chat
        .facade_hub
        .persist_loaded_tail(manager.clone(), request(&fixture.chat_id), options())
        .await;

    let store = fixture.ctx.chat.facade_hub.history_tails.as_ref().unwrap();
    assert!(store.manifest(&fixture.chat_id).await.is_none());
    fixture.ctx.chat.chat_manager.dispose();
}
