use super::*;
struct LegacySink(std::sync::Mutex<Vec<&'static str>>);
impl SessionSink for LegacySink {
    crate::forward_session_sink!(
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

    fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {
        self.0.lock().unwrap().push("message");
    }
    fn on_message_partial(&self, _id: &str, _content: Vec<MessageContent>) {
        self.0.lock().unwrap().push("partial");
    }
}
#[test]
fn contextual_defaults_delegate_to_old_adapter_callbacks() {
    use mainframe_types::transcript_presentation::*;
    let sink = LegacySink(std::sync::Mutex::new(Vec::new()));
    let presentation = TranscriptPresentation {
        version: 1,
        provider: "legacy".into(),
        turn_id: "t".into(),
        parent_tool_use_id: None,
        phase: None,
        state: PresentationState::Unknown,
        final_eligible: false,
        timing: None,
    };
    sink.on_message_with_presentation(Vec::new(), None, presentation.clone());
    sink.on_message_partial_with_presentation("id", Vec::new(), presentation.clone());
    sink.on_presentation_update(PresentationUpdate {
        presentation,
        source_message_ids: None,
    });
    assert_eq!(*sink.0.lock().unwrap(), ["message", "partial"]);
}
