use super::*;
use mainframe_types::transcript_presentation::{
    PresentationState, PresentationUpdate, TranscriptPresentation,
};
#[derive(Default)]
struct RecordingSink {
    messages: Mutex<Vec<TranscriptPresentation>>,
    updates: Mutex<Vec<PresentationUpdate>>,
    events: Mutex<Vec<String>>,
}
impl SessionSink for RecordingSink {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(
        &self,
        _content: Vec<mainframe_types::chat::MessageContent>,
        _metadata: Option<mainframe_types::adapter::MessageMetadata>,
    ) {
    }
    fn on_tool_result(
        &self,
        _content: Vec<mainframe_types::chat::MessageContent>,
        _vendor_id: Option<String>,
    ) {
    }
    fn on_permission(&self, _request: mainframe_adapter_api::ControlRequest) {}
    fn on_result(&self, _data: mainframe_types::adapter::SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {
        self.events.lock().unwrap().push("exit".into());
    }
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self, _vendor_id: Option<&str>) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: mainframe_types::adapter::ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<mainframe_types::chat::TodoItem>) {}
    fn on_pr_detected(&self, _pr: mainframe_types::adapter::DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: mainframe_adapter_api::LoadedSkill) {}
    fn on_subagent_child(
        &self,
        _parent_tool_use_id: &str,
        _blocks: Vec<mainframe_types::chat::MessageContent>,
    ) {
    }
    fn on_message_with_presentation(
        &self,
        _content: Vec<mainframe_types::chat::MessageContent>,
        _meta: Option<mainframe_types::adapter::MessageMetadata>,
        context: TranscriptPresentation,
    ) {
        self.messages.lock().unwrap().push(context);
    }
    fn on_presentation_update(&self, update: PresentationUpdate) {
        self.events
            .lock()
            .unwrap()
            .push(format!("{:?}", update.presentation.state));
        self.updates.lock().unwrap().push(update);
    }
}

fn setup() -> (CodexSession, Arc<RecordingSink>, JsonRpcHandlers) {
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
    *session.sink.lock().unwrap() = sink.clone();
    let handlers = session.build_handlers(Arc::new(ApprovalHandler::new(sink.clone())));
    (handlers.on_notification)("thread/started".into(), json!({"thread":{"id":"parent"}}));
    (session, sink, handlers)
}
fn start(handlers: &JsonRpcHandlers, turn: &str) {
    (handlers.on_notification)(
        "turn/started".into(),
        json!({"threadId":"parent","turn":{"id":turn}}),
    );
    final_item(handlers, turn);
}
fn final_item(handlers: &JsonRpcHandlers, turn: &str) {
    (handlers.on_notification)(
        "item/completed".into(),
        json!({"threadId":"parent","turnId":turn,"item":{"id":format!("answer-{turn}"),"type":"agentMessage","phase":"final_answer","text":"answer"}}),
    );
}
fn complete(handlers: &JsonRpcHandlers, turn: &str) {
    (handlers.on_notification)(
        "turn/completed".into(),
        json!({"threadId":"parent","turn":{"id":turn,"status":"completed"}}),
    );
}
fn assert_invalidated(sink: &RecordingSink) {
    let updates = sink.updates.lock().unwrap();
    assert!(
        updates
            .iter()
            .any(|u| u.presentation.turn_id == "[\"parent\",\"pending\"]"
                && u.presentation.state == PresentationState::Invalid)
    );
    assert!(
        updates
            .iter()
            .filter(|u| u.presentation.turn_id == "[\"parent\",\"closed\"]")
            .all(|u| u.presentation.state == PresentationState::Completed)
    );
}
#[tokio::test]
async fn kill_invalidates_delivered_final_from_unfinished_turn() {
    let (session, sink, handlers) = setup();
    start(&handlers, "closed");
    complete(&handlers, "closed");
    start(&handlers, "pending");
    assert!(sink.messages.lock().unwrap().last().unwrap().final_eligible);
    session.kill().await.unwrap();
    assert_invalidated(&sink);
}
#[test]
fn process_exit_invalidates_before_exit_and_stale_final_cannot_revive() {
    let (_session, sink, handlers) = setup();
    start(&handlers, "closed");
    complete(&handlers, "closed");
    start(&handlers, "pending");
    (handlers.on_exit)(Some(1));
    assert_invalidated(&sink);
    let events = sink.events.lock().unwrap().clone();
    assert_eq!(&events[events.len() - 2..], &["Invalid", "exit"]);
    let count = sink.messages.lock().unwrap().len();
    final_item(&handlers, "pending");
    complete(&handlers, "pending");
    assert_eq!(sink.messages.lock().unwrap().len(), count);
    let updates = sink.updates.lock().unwrap();
    assert!(
        updates
            .iter()
            .filter(|u| u.presentation.turn_id == "[\"parent\",\"pending\"]")
            .all(|u| u.presentation.state == PresentationState::Invalid)
    );
}

#[tokio::test]
async fn disposing_an_already_completed_turn_does_not_revoke_success() {
    for kill in [true, false] {
        let (session, sink, handlers) = setup();
        start(&handlers, "closed");
        complete(&handlers, "closed");
        let updates = sink.updates.lock().unwrap().len();
        if kill {
            session.kill().await.unwrap();
        } else {
            (handlers.on_exit)(Some(0));
        }
        assert_eq!(sink.updates.lock().unwrap().len(), updates);
        assert_eq!(sink.messages.lock().unwrap().len(), 1);
    }
}
