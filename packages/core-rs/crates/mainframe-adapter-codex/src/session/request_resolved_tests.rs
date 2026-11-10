use super::*;
use mainframe_adapter_api::test_support::RecordingSink;
#[test]
fn session_routes_server_request_resolved_to_approval_handler() {
    let session = CodexSession::new(
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
    );
    let sink = Arc::new(RecordingSink::default());
    let handlers = session.build_handlers(Arc::new(ApprovalHandler::new(sink.clone())));
    (handlers.on_request)(
        "item/fileChange/requestApproval".into(),
        json!({"itemId":"file"}),
        crate::types::RequestId::Number(7),
    );
    (handlers.on_notification)(
        "serverRequest/resolved".into(),
        json!({"threadId":"t1","requestId":7}),
    );
    (handlers.on_notification)("serverRequest/resolved".into(), json!({"requestId":7}));
    assert_eq!(sink.cancelled.lock().unwrap().len(), 1);
}
