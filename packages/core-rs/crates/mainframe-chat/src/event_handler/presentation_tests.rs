use super::presentation::apply_update;
use mainframe_types::transcript_presentation::*;

fn context(turn: &str, state: PresentationState) -> TranscriptPresentation {
    TranscriptPresentation {
        version: 1,
        provider: "test".into(),
        turn_id: turn.into(),
        parent_tool_use_id: None,
        phase: Some(PresentationPhase::Commentary),
        state,
        final_eligible: false,
        timing: None,
    }
}

#[test]
fn terminal_updates_match_exact_turn_and_parent_and_invalidation_is_monotonic() {
    let mut current = context("a", PresentationState::Running);
    apply_update(&mut current, &context("b", PresentationState::Completed));
    assert_eq!(current.state, PresentationState::Running);
    let mut child = context("a", PresentationState::Completed);
    child.parent_tool_use_id = Some("child".into());
    apply_update(&mut current, &child);
    assert_eq!(current.state, PresentationState::Running);
    apply_update(&mut current, &context("a", PresentationState::Invalid));
    apply_update(&mut current, &context("a", PresentationState::Completed));
    assert_eq!(current.state, PresentationState::Invalid);
}

use super::*;

fn handler() -> EventHandler<tests::FakeDeps> {
    let deps = tests::FakeDeps::new(tests::cell(ProcessState::Working, None), Vec::new());
    EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps,
    )
}
fn text(value: &str) -> Vec<MessageContent> {
    vec![MessageContent::Leaf(LeafContent::Text {
        text: value.into(),
        parent_tool_use_id: None,
    })]
}
fn metadata(id: &str) -> Option<MessageMetadata> {
    Some(MessageMetadata {
        model: None,
        usage: None,
        vendor_id: Some(id.into()),
    })
}
fn stored(handler: &EventHandler<tests::FakeDeps>, id: &str) -> TranscriptPresentation {
    let messages = handler.messages.lock().unwrap();
    let message = messages
        .get("c1")
        .unwrap()
        .iter()
        .find(|m| m.id == id)
        .unwrap();
    serde_json::from_value(message.metadata.as_ref().unwrap()[PRESENTATION_CONTEXT_KEY].clone())
        .unwrap()
}

#[test]
fn decorated_sink_updates_exact_sources_and_keeps_other_turns_and_phases() {
    let handler = handler();
    let sink = handler.build_sink("c1", Some("session".into()));
    for (id, turn) in [("work", "a"), ("final", "a"), ("other", "b")] {
        sink.on_message_with_presentation(
            text(id),
            metadata(id),
            context(turn, PresentationState::Running),
        );
    }
    let mut final_context = context("a", PresentationState::Completed);
    final_context.phase = Some(PresentationPhase::FinalAnswer);
    final_context.final_eligible = true;
    sink.on_presentation_update(PresentationUpdate {
        presentation: final_context,
        source_message_ids: Some(vec!["final".into()]),
    });
    assert_eq!(
        stored(&handler, "final").phase,
        Some(PresentationPhase::FinalAnswer)
    );
    assert_eq!(stored(&handler, "work").state, PresentationState::Running);
    sink.on_presentation_update(PresentationUpdate {
        presentation: context("a", PresentationState::Cancelled),
        source_message_ids: None,
    });
    assert_eq!(stored(&handler, "work").state, PresentationState::Cancelled);
    assert_eq!(
        stored(&handler, "final").phase,
        Some(PresentationPhase::FinalAnswer)
    );
    assert_eq!(stored(&handler, "other").state, PresentationState::Running);
}

#[test]
fn contextual_child_callbacks_cannot_replace_or_clear_the_parent_overlay() {
    let handler = handler();
    let sink = handler.build_sink("c1", Some("session".into()));
    sink.on_message_partial_with_presentation(
        "parent",
        text("🦀 partial"),
        context("a", PresentationState::Running),
    );
    let before = handler.partial_overlays.message_for("c1").unwrap();
    let mut child = context("child", PresentationState::Running);
    child.parent_tool_use_id = Some("tool".into());
    sink.on_message_partial_with_presentation("child", text("child partial"), child.clone());
    sink.on_message_with_presentation(text("child complete"), metadata("child"), child);
    assert_eq!(handler.partial_overlays.message_for("c1").unwrap(), before);
    sink.on_message_with_presentation(
        text("🦀 committed"),
        metadata("parent"),
        context("a", PresentationState::Running),
    );
    assert!(handler.partial_overlays.message_for("c1").is_none());
    assert_eq!(stored(&handler, "parent").turn_id, "a");
}

#[test]
fn malformed_context_keeps_the_legacy_parent_partial_visible() {
    let handler = handler();
    let sink = handler.build_sink("c1", Some("session".into()));
    let mut invalid = context("a", PresentationState::Running);
    invalid.version = 9;
    sink.on_message_partial_with_presentation("id", text("Visible 🦀"), invalid);
    let overlay = handler.partial_overlays.message_for("c1").unwrap();
    assert_eq!(overlay.content, text("Visible 🦀"));
    assert!(overlay.metadata.is_none());
}
