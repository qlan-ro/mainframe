#[tokio::test]
async fn connecting_registers_a_facade_client_and_disconnecting_unregisters_it() {
    let server = server_with_mock_adapter().await;
    assert_eq!(server.ctx.chat.facade_hub.connection_count(), 0);

    let ws = WsClient::connect(server.addr, "/acp/mock-cli", None)
        .await
        .unwrap();
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(2),
        Duration::from_millis(5),
        async || !(server.ctx.chat.facade_hub.connection_count() == 0),
    )
    .await
    .unwrap();
    assert_eq!(server.ctx.chat.facade_hub.connection_count(), 1);

    drop(ws);
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(2),
        Duration::from_millis(5),
        async || !(server.ctx.chat.facade_hub.connection_count() != 0),
    )
    .await
    .unwrap();
    assert_eq!(server.ctx.chat.facade_hub.connection_count(), 0);
}
