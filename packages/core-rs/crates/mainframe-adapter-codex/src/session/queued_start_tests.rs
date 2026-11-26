use super::*;
use mainframe_adapter_api::test_support::RecordingSink;
fn session() -> CodexSession {
    CodexSession::new(
        SessionOptions {
            project_path: "/tmp".into(),
            chat_id: None,
            mainframe_chat_id: "chat".into(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        ResolvedPath::from_value("/usr/bin:/bin"),
        Arc::new(BackgroundTaskTracker::new()),
    )
}

#[tokio::test]
async fn stop_before_stdin_write_cancels_the_queued_start() {
    let session = session();
    let (mut client, mut writes) = JsonRpcClient::test_transport();
    client.test_enable_write_filter();
    let client = Arc::new(client);
    *session.client.lock().unwrap() = Some(client.clone());
    session.state.lock().unwrap().thread_id = Some("thread".into());
    session.config.lock().unwrap().model = Some("gpt-5.5".into());
    let paused = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let check = paused.clone();
    session.guard_queued_write(
        "queued".into(),
        Box::new(move || !check.load(Ordering::SeqCst)),
    );
    let start =
        session.send_message_inner("queued input".into(), Vec::new(), Some("queued".into()));
    tokio::pin!(start);
    let bytes = tokio::select! {
        result = &mut start => panic!("premature result {result:?}"),
        bytes = writes.recv() => bytes.unwrap(),
    };
    paused.store(true, Ordering::SeqCst);
    session.interrupt_inner().await.unwrap();
    assert!(!client.test_allow_write(&bytes));
    assert!(matches!(
        start.await,
        Err(AdapterError::DeliveryRejected(_))
    ));
    assert!(writes.try_recv().is_err());
}

#[tokio::test]
async fn stop_after_write_interrupts_when_turn_id_arrives() {
    let session = session();
    let (mut client, mut writes) = JsonRpcClient::test_transport();
    client.test_enable_write_filter();
    let client = Arc::new(client);
    *session.client.lock().unwrap() = Some(client.clone());
    session.state.lock().unwrap().thread_id = Some("thread".into());
    session.config.lock().unwrap().model = Some("gpt-5.5".into());
    let handlers = session.build_handlers(Arc::new(ApprovalHandler::new(Arc::new(
        RecordingSink::default(),
    ))));
    let start =
        session.send_message_inner("queued input".into(), Vec::new(), Some("queued".into()));
    tokio::pin!(start);
    tokio::select! {
        result = &mut start => panic!("premature result {result:?}"),
        bytes = writes.recv() => {
            let bytes = bytes.unwrap();
            assert!(client.test_allow_write(&bytes));
            let rpc: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(rpc["method"], "turn/start");
        }
    }
    session.interrupt_inner().await.unwrap();
    assert!(writes.try_recv().is_err());
    (handlers.on_notification)(
        "turn/started".into(),
        json!({"threadId":"thread","turn":{"id":"new-turn"}}),
    );
    let bytes = tokio::time::timeout(Duration::from_secs(1), writes.recv())
        .await
        .unwrap()
        .unwrap();
    let rpc: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(rpc["method"], "turn/interrupt");
    assert_eq!(
        rpc["params"],
        json!({"threadId":"thread","turnId":"new-turn"})
    );
    client.test_acknowledge(rpc["id"].as_i64().unwrap());
}
