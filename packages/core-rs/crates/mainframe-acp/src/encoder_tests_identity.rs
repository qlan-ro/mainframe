use super::*;
use crate::encoder::delta::EncodedDelta;
use crate::revision_log::{ReplayPlan, RevisionLog};
use crate::session_state::SessionState;
use mainframe_types::acp::extensions::RevisionCursor;
use mainframe_types::acp::update::SessionUpdate;
use mainframe_types::transcript_presentation::*;

fn snapshot(answer: Option<&str>, running: bool) -> DisplayMessage {
    let mut content = vec![tool_call(
        "exec",
        "Read",
        ToolCategory::Explore,
        Some("fixture"),
    )];
    if let Some(answer) = answer {
        content.push(text(answer));
    }
    let mut message = dmsg("exec", DisplayMessageType::Assistant, content);
    let sources = (0..message.content.len())
        .map(|index| source(index, running))
        .collect();
    message.metadata = Some(HashMap::from([(
        PRESENTATION_SOURCES_KEY.into(),
        serde_json::to_value(DisplayPresentationSources {
            version: 1,
            sources,
        })
        .unwrap(),
    )]));
    message
}

fn source(index: usize, running: bool) -> DisplayPresentationSource {
    let final_answer = index == 1;
    DisplayPresentationSource {
        path: vec![index],
        identity: PresentationSourceIdentity {
            source_message_id: format!("source-{index}"),
            source_block_index: 0,
            streaming: Some(running && final_answer),
            presentation: TranscriptPresentation {
                version: 1,
                provider: "codex".into(),
                turn_id: "synthetic-turn".into(),
                parent_tool_use_id: None,
                phase: Some(if final_answer {
                    PresentationPhase::FinalAnswer
                } else {
                    PresentationPhase::Work
                }),
                state: if running && final_answer {
                    PresentationState::Running
                } else {
                    PresentationState::Completed
                },
                final_eligible: final_answer,
                timing: None,
            },
        },
    }
}

fn final_update(updates: &[SessionUpdate]) -> Value {
    updates
        .iter()
        .map(|u| serde_json::to_value(u).unwrap())
        .find(|u| u["messageId"] == "message:0:top:exec")
        .expect("final answer update")
}

#[test]
fn tool_first_final_survives_fresh_persisted_display_replay() {
    let stored = serde_json::to_vec(&snapshot(Some("Final answer"), false)).unwrap();
    let restored: DisplayMessage = serde_json::from_slice(&stored).unwrap();
    let items = encode(&[restored]);
    assert_eq!(
        items.iter().map(EncodedItem::id).collect::<Vec<_>>(),
        ["tool:exec", "message:0:top:exec"]
    );
    let updates = SessionState::new().diff(&items);
    assert_eq!(updates.len(), 2);
    let answer = final_update(&updates);
    assert_eq!(answer["content"][0]["text"], "Final answer");
    let source = &answer["_meta"][MAINFRAME_META_NAMESPACE]["presentationSources"]["sources"][0];
    assert_eq!(source["presentation"]["state"], "completed");
    assert_eq!(source["streaming"], false);
}

#[test]
fn incremental_growth_and_completion_keep_ids_and_deliver_terminal_metadata() {
    let mut state = SessionState::new();
    state.seed_containers(&encode_containers(&[snapshot(None, false)], None));
    let mut ids = Vec::new();
    for (answer, running) in [
        ("Final", true),
        ("Final answer", true),
        ("Final answer", false),
    ] {
        let items = encode_container(
            &snapshot(Some(answer), running),
            running.then_some(StreamingLeafKind::Text),
        );
        ids.push(items.iter().map(|i| i.id().to_string()).collect::<Vec<_>>());
        let updates = state.apply(
            &EncodedDelta {
                full: false,
                changes: vec![(0, items)],
                len: 1,
            },
            || panic!("seeded"),
        );
        let update = final_update(&updates);
        if !running {
            assert!(update.get("content").is_none());
            assert_eq!(
                update["_meta"][MAINFRAME_META_NAMESPACE]["presentationSources"]["sources"][0]["presentation"]
                    ["state"],
                "completed"
            );
            assert!(
                update["_meta"][MAINFRAME_META_NAMESPACE]
                    .get("streaming")
                    .is_none()
            );
        }
    }
    assert!(ids.windows(2).all(|pair| pair[0] == pair[1]));
}

#[test]
fn revision_replay_delivers_answer_and_old_daemon_cursor_requires_full_replay() {
    let initial = encode(&[snapshot(None, false)]);
    let complete = encode(&[snapshot(Some("Final answer"), false)]);
    let mut log = RevisionLog::new("new-daemon".into());
    log.seed(&initial);
    let cursor = log.boundary();
    log.record(&complete);
    let ReplayPlan::Incremental(updates) = log.plan(&cursor, &complete) else {
        panic!("incremental")
    };
    assert_eq!(final_update(&updates)["content"][0]["text"], "Final answer");
    assert_eq!(
        log.plan(
            &RevisionCursor {
                epoch: "old-daemon".into(),
                revision: 0
            },
            &complete
        ),
        ReplayPlan::Full
    );
}

#[test]
fn namespaces_handle_native_ids_that_look_like_segments_and_nested_containers() {
    let message = dmsg(
        "exec",
        DisplayMessageType::Assistant,
        vec![
            tool_call("message:0:top:exec", "Read", ToolCategory::Explore, None),
            thinking("reason"),
            text("first"),
            DisplayContent::Node(DisplayNode::TaskGroup {
                agent_id: "exec".into(),
                task_args: HashMap::new(),
                calls: vec![text("nested")],
                result: None,
                timing: None,
            }),
            text("last"),
        ],
    );
    let items = encode(&[message]);
    let ids: std::collections::HashSet<_> = items.iter().map(EncodedItem::id).collect();
    assert_eq!(ids.len(), items.len());
    assert!(ids.contains("message:0:task:exec"));
    assert!(ids.contains("message:1:top:exec"));
    assert!(ids.contains("tool:message:0:top:exec"));
}

#[test]
fn compaction_replay_matches_shared_client_fixture() {
    let messages: Vec<DisplayMessage> =
        serde_json::from_str(include_str!("../fixtures/tool-first-display.json")).unwrap();
    let updates = SessionState::new().diff(&encode(&messages));
    let expected: Value =
        serde_json::from_str(include_str!("../fixtures/tool-first-replay.json")).unwrap();
    assert_eq!(serde_json::to_value(updates).unwrap(), expected);
}

#[test]
fn tool_completion_and_final_text_are_delivered_for_shared_and_distinct_container_ids() {
    for container_id in ["exec", "distinct"] {
        let mut message = dmsg(
            container_id,
            DisplayMessageType::Assistant,
            vec![tool_call("exec", "Read", ToolCategory::Explore, None)],
        );
        let mut state = SessionState::new();
        let started = state.diff(&encode(&[message.clone()]));
        assert_eq!(
            serde_json::to_value(&started[0]).unwrap()["status"],
            "in_progress"
        );
        message.content = snapshot(Some("Final answer"), false).content;
        let updates = state.diff(&encode(&[message]));
        assert_eq!(updates.len(), 2);
        assert_eq!(
            serde_json::to_value(&updates[0]).unwrap()["status"],
            "completed"
        );
        assert_eq!(
            serde_json::to_value(&updates[1]).unwrap()["content"][0]["text"],
            "Final answer"
        );
    }
}
