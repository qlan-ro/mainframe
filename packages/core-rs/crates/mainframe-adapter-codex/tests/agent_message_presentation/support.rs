use mainframe_adapter_api::*;
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use mainframe_types::adapter::*;
use mainframe_types::chat::MessageContent;
use mainframe_types::transcript_presentation::*;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct Recorded {
    pub partials: Vec<(String, Value, Option<TranscriptPresentation>)>,
    pub messages: Vec<(Option<String>, Value, Option<TranscriptPresentation>)>,
    pub updates: Vec<PresentationUpdate>,
}
#[derive(Default)]
pub struct Sink(pub Mutex<Recorded>);
impl SessionSink for Sink {
    mainframe_adapter_api::forward_session_sink!(
        on_init,
        on_tool_result,
        on_permission,
        on_result,
        on_exit,
        on_error,
        on_compact,
        on_compact_start,
        on_context_usage,
        on_plan_file,
        on_skill_file,
        on_queued_processed,
        on_todo_update,
        on_pr_detected,
        on_cli_message,
        on_skill_loaded,
        on_subagent_child
    );

    fn on_message(&self, c: Vec<MessageContent>, m: Option<MessageMetadata>) {
        self.0
            .lock()
            .unwrap()
            .messages
            .push((m.and_then(|m| m.vendor_id), json!(c), None));
    }
    fn on_message_partial(&self, id: &str, c: Vec<MessageContent>) {
        self.0
            .lock()
            .unwrap()
            .partials
            .push((id.into(), json!(c), None));
    }
    fn on_message_with_presentation(
        &self,
        c: Vec<MessageContent>,
        m: Option<MessageMetadata>,
        p: TranscriptPresentation,
    ) {
        self.0
            .lock()
            .unwrap()
            .messages
            .push((m.and_then(|m| m.vendor_id), json!(c), Some(p)));
    }
    fn on_message_partial_with_presentation(
        &self,
        id: &str,
        c: Vec<MessageContent>,
        p: TranscriptPresentation,
    ) {
        self.0
            .lock()
            .unwrap()
            .partials
            .push((id.into(), json!(c), Some(p)));
    }
    fn on_presentation_update(&self, p: PresentationUpdate) {
        self.0.lock().unwrap().updates.push(p);
    }
}
pub fn send(s: &Arc<Sink>, state: &mut CodexSessionState, method: &str, p: Value) {
    handle_notification(method, &p, &(s.clone() as Arc<dyn SessionSink>), state);
}
pub fn setup() -> (Arc<Sink>, CodexSessionState) {
    let s = Arc::new(Sink::default());
    let mut state = CodexSessionState::default();
    state.agent_message_partial.emit_interval_ms = 0;
    send(
        &s,
        &mut state,
        "thread/started",
        json!({"thread":{"id":"thread"}}),
    );
    send(
        &s,
        &mut state,
        "turn/started",
        json!({"threadId":"thread","turn":{"id":"turn","startedAt":10}}),
    );
    (s, state)
}
pub fn item(phase: Value) -> Value {
    json!({"threadId":"thread","turnId":"turn","item":{"type":"agentMessage","id":"answer","text":"Hello","phase":phase}})
}
pub fn delta(s: &Arc<Sink>, state: &mut CodexSessionState) {
    send(
        s,
        state,
        "item/agentMessage/delta",
        json!({"threadId":"thread","turnId":"turn","itemId":"answer","delta":"Hello"}),
    );
}
