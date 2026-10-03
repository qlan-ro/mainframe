use crate::presentation_history::convert_turns;
use crate::types::ThreadReadTurn;
use mainframe_types::transcript_presentation::*;
use serde_json::json;
use std::collections::HashMap;
#[test]
fn explicit_history_turns_preserve_source_context_without_changing_content() {
    let turns:Vec<ThreadReadTurn>=serde_json::from_value(json!([
        {"id":"one","status":"completed","startedAt":10,"completedAt":12,"durationMs":1900,"items":[
            {"type":"agentMessage","id":"comment","text":"🦀work","phase":"commentary"},
            {"type":"agentMessage","id":"final","text":"done","phase":"final_answer"}]},
        {"id":"two","status":"interrupted","items":[{"type":"agentMessage","id":"stopped","text":"partial","phase":"final_answer"}]}
    ])).unwrap();
    let mut messages = convert_turns(&turns, "thread", &HashMap::new(), &HashMap::new());
    let contexts: Vec<TranscriptPresentation> = messages
        .iter()
        .map(|m| {
            serde_json::from_value(m.metadata.as_ref().unwrap()[PRESENTATION_CONTEXT_KEY].clone())
                .unwrap()
        })
        .collect();
    assert_eq!(contexts[0].phase, Some(PresentationPhase::Commentary));
    assert!(contexts[1].final_eligible);
    assert_eq!(contexts[1].state, PresentationState::Completed);
    assert_eq!(
        contexts[1].timing.as_ref().unwrap().started_at_ms,
        Some(10000)
    );
    assert_eq!(contexts[2].state, PresentationState::Cancelled);
    assert_ne!(contexts[0].turn_id, contexts[2].turn_id);
    let all: Vec<_> = turns.into_iter().flat_map(|t| t.items).collect();
    let legacy = crate::history_convert::convert_thread_items(
        &all,
        "thread",
        &HashMap::new(),
        &HashMap::new(),
    );
    for (m, l) in messages.iter_mut().zip(&legacy) {
        m.metadata = None;
        m.timestamp = l.timestamp.clone();
    }
    assert_eq!(messages, legacy);
}
#[test]
fn old_schema_and_malformed_optional_fields_keep_text_visible() {
    for extras in [
        json!({}),
        json!({"phase":false}),
        json!({"phase":"final_answer","delivery":"async"}),
        json!({"phase":"final_answer","questions":{}}),
    ] {
        let mut item = json!({"id":"text","type":"agentMessage","text":"visible"});
        item.as_object_mut()
            .unwrap()
            .extend(extras.as_object().unwrap().clone());
        let turns: Vec<ThreadReadTurn> =serde_json::from_value(json!([{"id":"turn","status":"completed","startedAt":-1,"completedAt":"bad","items":[item]}])).unwrap();
        let messages = convert_turns(&turns, "thread", &HashMap::new(), &HashMap::new());
        assert_eq!(json!(messages[0].content)[0]["text"], "visible");
        let p: TranscriptPresentation = serde_json::from_value(
            messages[0].metadata.as_ref().unwrap()[PRESENTATION_CONTEXT_KEY].clone(),
        )
        .unwrap();
        assert!(!p.final_eligible);
        assert!(p.timing.is_none());
    }
}
#[test]
fn ambiguous_reused_source_ids_have_no_foldable_history_context() {
    let turns: Vec<ThreadReadTurn> =serde_json::from_value(json!([
        {"id":"one","status":"completed","items":[{"id":"same","type":"agentMessage","text":"one","phase":"final_answer"}]},
        {"id":"two","status":"completed","items":[{"id":"same","type":"agentMessage","text":"two","phase":"final_answer"}]}
    ])).unwrap();
    let messages = convert_turns(&turns, "thread", &HashMap::new(), &HashMap::new());
    assert_eq!(messages.len(), 2);
    assert!(messages.iter().all(|m| m.metadata.is_none()));
}
#[test]
fn flattened_child_history_keeps_content_without_borrowing_parent_turn_context() {
    let turns: Vec<ThreadReadTurn> =serde_json::from_value(json!([{"id":"turn","status":"completed","items":[
        {"type":"subAgentActivity","id":"activity","kind":"started","agentThreadId":"child","agentPath":"/root/child"}
    ]}])).unwrap();
    let children = HashMap::from([(
        "child".into(),
        serde_json::from_value(json!([
            {"id":"child-final","type":"agentMessage","text":"child done","phase":"final_answer"}
        ]))
        .unwrap(),
    )]);
    let messages = convert_turns(&turns, "thread", &children, &HashMap::new());
    assert!(messages.iter().all(|m| m.metadata.is_none()));
    assert!(
        messages
            .iter()
            .flat_map(|m| &m.content)
            .any(|b| json!(b)["text"] == "child done")
    );
}
