#[tokio::test]
async fn adapter_capability_is_checked_before_the_message() {
    let h = harness(false, with_session()).await;
    let resp = h.fork(&h.chat_id, r#"{"fromMessageId":"m-unknown"}"#).await;
    assert_eq!(resp.status(), 422);
}
