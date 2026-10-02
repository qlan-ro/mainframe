use mainframe_adapter_api::*;
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use mainframe_types::adapter::*;
use mainframe_types::chat::{MessageContent, TodoItem};
use mainframe_types::context::SkillFileEntry;
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
    fn on_init(&self, _: &str) {}
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
    fn on_tool_result(&self, _: Vec<MessageContent>, _: Option<String>) {}
    fn on_permission(&self, _: ControlRequest) {}
    fn on_result(&self, _: SessionResult) {}
    fn on_exit(&self, _: Option<i32>) {}
    fn on_error(&self, _: AdapterError) {}
    fn on_compact(&self, _: Option<&str>) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _: ContextUsage) {}
    fn on_plan_file(&self, _: &str) {}
    fn on_skill_file(&self, _: SkillFileEntry) {}
    fn on_queued_processed(&self, _: &str) {}
    fn on_todo_update(&self, _: Vec<TodoItem>) {}
    fn on_pr_detected(&self, _: DetectedPr) {}
    fn on_cli_message(&self, _: &str) {}
    fn on_skill_loaded(&self, _: LoadedSkill) {}
    fn on_subagent_child(&self, _: &str, _: Vec<MessageContent>) {}
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
