use super::*;
use mainframe_types::transcript_presentation::*;

fn source(id: &str, index: usize, phase: PresentationPhase) -> DisplayPresentationSource {
    DisplayPresentationSource {
        path: vec![index],
        identity: PresentationSourceIdentity {
            source_message_id: id.into(),
            source_block_index: 0,
            streaming: Some(false),
            presentation: TranscriptPresentation {
                version: 1,
                provider: "codex".into(),
                turn_id: "thread/turn".into(),
                parent_tool_use_id: None,
                phase: Some(phase),
                state: PresentationState::Completed,
                final_eligible: phase == PresentationPhase::FinalAnswer,
                timing: None,
            },
        },
    }
}

#[test]
fn coalesced_unicode_spans_are_item_local_and_do_not_change_legacy_output() {
    let mut message = dmsg(
        "m",
        DisplayMessageType::Assistant,
        vec![text("🦀\n\n"), text("Answer e\u{301}")],
    );
    let legacy = encode(&[message.clone()]);
    message.metadata = Some(HashMap::from([(
        PRESENTATION_SOURCES_KEY.into(),
        serde_json::to_value(DisplayPresentationSources {
            version: 1,
            sources: vec![
                source("a", 0, PresentationPhase::Commentary),
                source("b", 1, PresentationPhase::FinalAnswer),
            ],
        })
        .unwrap(),
    )]));
    let encoded = encode(&[message]);
    let EncodedItem::Message { content, meta, .. } = &encoded[0] else {
        panic!("message")
    };
    assert_eq!(content.len(), 1);
    let sources =
        &meta.as_ref().unwrap()[MAINFRAME_META_NAMESPACE]["presentationSources"]["sources"];
    assert_eq!(
        sources[0]["target"],
        json!({"type":"text","contentBlockIndex":0,"startUtf16":0,"endUtf16":4})
    );
    assert_eq!(sources[1]["target"]["startUtf16"], 4);
    assert!(
        meta.as_ref().unwrap()[MAINFRAME_META_NAMESPACE]
            .get("messageMeta")
            .is_none()
    );
    let mut stripped = encoded;
    if let EncodedItem::Message {
        meta: Some(meta), ..
    } = &mut stripped[0]
    {
        meta[MAINFRAME_META_NAMESPACE]
            .as_object_mut()
            .unwrap()
            .remove("presentationSources");
    }
    assert_eq!(stripped, legacy);
}

fn item_meta(item: &EncodedItem) -> &Value {
    match item {
        EncodedItem::Message { meta, .. }
        | EncodedItem::Thought { meta, .. }
        | EncodedItem::ToolCall { meta, .. } => &meta.as_ref().unwrap()[MAINFRAME_META_NAMESPACE],
    }
}
fn stamp(message: &mut DisplayMessage, sources: Vec<DisplayPresentationSource>) {
    message.metadata = Some(HashMap::from([(
        PRESENTATION_SOURCES_KEY.into(),
        serde_json::to_value(DisplayPresentationSources {
            version: 1,
            sources,
        })
        .unwrap(),
    )]));
}

#[test]
fn many_tools_carry_only_their_own_source_and_preserve_legacy_segments() {
    let content = (0..32)
        .flat_map(|i| {
            vec![
                text(&format!("step {i}")),
                tool_call(&format!("t{i}"), "Read", ToolCategory::Explore, None),
            ]
        })
        .collect::<Vec<_>>();
    let mut message = dmsg("many", DisplayMessageType::Assistant, content);
    let legacy = encode(&[message.clone()]);
    let sources = (0..64)
        .map(|i| source(&format!("s{i}"), i, PresentationPhase::Work))
        .collect();
    stamp(&mut message, sources);
    let encoded = encode(&[message]);
    assert_eq!(encoded.len(), 64);
    for (index, item) in encoded.iter().enumerate() {
        let meta = item_meta(item);
        let sources = meta["presentationSources"]["sources"].as_array().unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0]["sourceMessageId"], format!("s{index}"));
        assert!(meta.get("messageMeta").is_none());
        assert_eq!(item.id(), legacy[index].id());
    }
}

#[test]
fn growing_final_then_terminal_patch_retains_ranges_identity_and_replay_content() {
    let mut message = dmsg(
        "m",
        DisplayMessageType::Assistant,
        vec![text("work\n\n"), text("🦀")],
    );
    let work = source("work", 0, PresentationPhase::Commentary);
    let mut final_source = source("final", 1, PresentationPhase::FinalAnswer);
    final_source.identity.streaming = Some(true);
    stamp(&mut message, vec![work.clone(), final_source.clone()]);
    let first = encode_revision(&[message.clone()], Some(StreamingLeafKind::Text));
    message.content[1] = text("🦀 final e\u{301}");
    let grown = encode_revision(&[message.clone()], Some(StreamingLeafKind::Text));
    assert_eq!(first[0].id(), grown[0].id());
    final_source.identity.streaming = Some(false);
    stamp(&mut message, vec![work, final_source]);
    let committed = encode_revision(&[message.clone()], None);
    assert_eq!(committed, encode(&[message]));
    let entries = &item_meta(&committed[0])["presentationSources"]["sources"];
    assert_eq!(entries[0]["target"]["endUtf16"], 6);
    assert_eq!(entries[1]["target"]["startUtf16"], 6);
    assert_eq!(entries[1]["target"]["endUtf16"], 17);
    assert_eq!(entries[1]["streaming"], false);
}

#[test]
fn ambiguous_source_paths_cannot_hide_content_or_change_streaming() {
    let mut message = dmsg("m", DisplayMessageType::Assistant, vec![text("visible 🦀")]);
    let plain = encode_revision(&[message.clone()], Some(StreamingLeafKind::Text));
    stamp(
        &mut message,
        vec![
            source("a", 0, PresentationPhase::Commentary),
            source("b", 0, PresentationPhase::FinalAnswer),
        ],
    );
    assert_eq!(
        encode_revision(&[message], Some(StreamingLeafKind::Text)),
        plain
    );
}

#[test]
fn nested_sources_must_match_the_encoded_ancestor() {
    let message = dmsg(
        "m",
        DisplayMessageType::Assistant,
        vec![DisplayContent::Node(DisplayNode::TaskGroup {
            agent_id: "task".into(),
            task_args: HashMap::new(),
            calls: vec![text("Child 🦀")],
            result: None,
            timing: None,
        })],
    );
    for parent in [None, Some("task")] {
        let mut message = message.clone();
        let mut child = source("child", 0, PresentationPhase::FinalAnswer);
        child.path = vec![0, 0];
        child.identity.presentation.parent_tool_use_id = parent.map(str::to_string);
        stamp(&mut message, vec![child]);
        let encoded = encode(&[message]);
        assert_eq!(encoded[1].id(), "task-message");
        assert_eq!(item_meta(&encoded[1])["parentToolCallId"], "task");
        assert_eq!(
            item_meta(&encoded[1]).get("presentationSources").is_some(),
            parent.is_some()
        );
    }
}
