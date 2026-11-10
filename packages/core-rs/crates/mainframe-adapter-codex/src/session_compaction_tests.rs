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
fn request(session: &CodexSession, id: &str) -> NativeCompactionRequest {
    NativeCompactionRequest {
        id: id.into(),
        session_generation: session.id.clone(),
        origin: CompactionOrigin::Idle,
        command_uuid: "command".into(),
    }
}
fn completed(session: &CodexSession, sink: &Arc<dyn SessionSink>, id: &str) {
    handle_notification(
        "item/completed",
        &json!({"threadId":"thread","item":{"id":id,"type":"contextCompaction"}}),
        sink,
        &mut session.state.lock().unwrap(),
    );
}
#[tokio::test]
async fn exact_native_rpc_empty_ack_and_startless_completion() {
    let session = session();
    let (client, mut writes) = JsonRpcClient::test_transport();
    let client = Arc::new(client);
    *session.client.lock().unwrap() = Some(client.clone());
    session.state.lock().unwrap().thread_id = Some("thread".into());
    session.state.lock().unwrap().compaction_emitted = true;
    let recording = Arc::new(RecordingSink::default());
    let sink: Arc<dyn SessionSink> = recording.clone();
    let future = session.compact_idle(request(&session, "request"));
    tokio::pin!(future);
    tokio::select! { result=&mut future=>panic!("premature result {result:?}"), bytes=writes.recv()=> {
        let rpc:Value=serde_json::from_slice(&bytes.unwrap()).unwrap();
        assert_eq!(rpc["method"],"thread/compact/start"); assert_eq!(rpc["params"],json!({"threadId":"thread"}));
        client.test_acknowledge(rpc["id"].as_i64().unwrap());
    }}
    tokio::select! { result=&mut future=>panic!("ack fabricated completion {result:?}"), _=tokio::task::yield_now()=>{} }
    assert!(!session.ready_for_input());
    completed(&session, &sink, "item");
    let metadata = future.await.unwrap();
    assert_eq!(metadata.vendor_id.as_deref(), Some("item"));
    completed(&session, &sink, "item");
    handle_notification(
        "thread/compacted",
        &json!({"threadId":"thread"}),
        &sink,
        &mut session.state.lock().unwrap(),
    );
    assert_eq!(recording.compactions.lock().unwrap().len(), 1);
    assert!(session.ready_for_input());
}
#[tokio::test]
async fn timeout_quarantines_late_item_and_never_labels_newer_request() {
    let session = session();
    let recording = Arc::new(RecordingSink::default());
    let sink: Arc<dyn SessionSink> = recording.clone();
    let maintenance = session.state.lock().unwrap().maintenance.clone();
    let receiver = maintenance.begin(request(&session, "old")).unwrap();
    assert!(maintenance.wait(receiver, 1).await.is_err());
    assert!(maintenance.begin(request(&session, "new")).is_err());
    completed(&session, &sink, "old-item");
    assert!(recording.compactions.lock().unwrap().is_empty());
    assert!(session.ready_for_input());
    let receiver = maintenance.begin(request(&session, "new")).unwrap();
    completed(&session, &sink, "old-item");
    assert!(recording.compactions.lock().unwrap().is_empty());
    assert!(!session.ready_for_input());
    completed(&session, &sink, "new-item");
    assert_eq!(
        maintenance.wait(receiver, 10).await.unwrap().request_id,
        "new"
    );
    assert_eq!(recording.compactions.lock().unwrap().len(), 1);
}
#[tokio::test]
async fn legacy_only_completion_has_no_invented_counts_and_wrong_thread_is_ignored() {
    let session = session();
    let recording = Arc::new(RecordingSink::default());
    let sink: Arc<dyn SessionSink> = recording.clone();
    session.state.lock().unwrap().thread_id = Some("thread".into());
    let maintenance = session.state.lock().unwrap().maintenance.clone();
    let receiver = maintenance.begin(request(&session, "legacy")).unwrap();
    handle_notification(
        "thread/compacted",
        &json!({"threadId":"other"}),
        &sink,
        &mut session.state.lock().unwrap(),
    );
    assert!(!maintenance.ready());
    handle_notification(
        "thread/compacted",
        &json!({"threadId":"thread"}),
        &sink,
        &mut session.state.lock().unwrap(),
    );
    let metadata = maintenance.wait(receiver, 10).await.unwrap();
    assert_eq!(metadata.before_tokens, None);
    assert_eq!(metadata.after_tokens, None);
    assert_eq!(recording.compactions.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn late_canonical_after_legacy_timeout_is_quarantined() {
    let session = session();
    let recording = Arc::new(RecordingSink::default());
    let sink: Arc<dyn SessionSink> = recording.clone();
    let maintenance = session.state.lock().unwrap().maintenance.clone();
    let rx = maintenance.begin(request(&session, "old")).unwrap();
    assert!(maintenance.wait(rx, 1).await.is_err());
    handle_notification(
        "thread/compacted",
        &json!({}),
        &sink,
        &mut session.state.lock().unwrap(),
    );
    assert!(maintenance.ready());
    let rx = maintenance.begin(request(&session, "new")).unwrap();
    completed(&session, &sink, "old-canonical");
    assert!(recording.compactions.lock().unwrap().is_empty());
    assert!(!maintenance.ready());
    completed(&session, &sink, "new-canonical");
    assert_eq!(maintenance.wait(rx, 10).await.unwrap().request_id, "new");
}

#[tokio::test]
async fn definitive_rpc_rejection_releases_readiness_without_success() {
    let session = session();
    let (client, mut writes) = JsonRpcClient::test_transport();
    let client = Arc::new(client);
    *session.client.lock().unwrap() = Some(client.clone());
    session.state.lock().unwrap().thread_id = Some("thread".into());
    let future = session.compact_idle(request(&session, "rejected"));
    tokio::pin!(future);
    tokio::select! { result=&mut future=>panic!("premature result {result:?}"), bytes=writes.recv()=> {
        let rpc:Value=serde_json::from_slice(&bytes.unwrap()).unwrap();
        client.test_reject(rpc["id"].as_i64().unwrap());
    }}
    assert!(future.await.is_err());
    assert!(session.ready_for_input());
}

#[tokio::test]
async fn prompt_rpc_preserves_rejected_versus_unconfirmed_acceptance() {
    for rejected in [true, false] {
        let session = session();
        let (client, mut writes) = JsonRpcClient::test_transport();
        let client = Arc::new(client);
        *session.client.lock().unwrap() = Some(client.clone());
        session.state.lock().unwrap().thread_id = Some("thread".into());
        session.config.lock().unwrap().model = Some("gpt-5.5".into());
        let future =
            session.send_message_inner("queued input".into(), Vec::new(), Some("original".into()));
        tokio::pin!(future);
        tokio::select! { result=&mut future=>panic!("premature result {result:?}"), bytes=writes.recv()=> {
            let rpc:Value=serde_json::from_slice(&bytes.unwrap()).unwrap();
            assert_eq!(rpc["method"], "turn/start");
            if rejected { client.test_reject(rpc["id"].as_i64().unwrap()); }
        }}
        let error = future.await.unwrap_err();
        assert_eq!(matches!(error, AdapterError::DeliveryRejected(_)), rejected);
    }
}
