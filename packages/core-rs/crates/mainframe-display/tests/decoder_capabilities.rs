#![allow(clippy::unwrap_used, clippy::expect_used)]
use mainframe_display::decoders::{MainframeDecoders, NoopDecoders};
use mainframe_display::display_pipeline::prepare_messages_with_decoders;
use mainframe_display::incremental::IncrementalProjector;
use mainframe_display::{DisplayProjector, ProjectionInput, RawChanges};
use mainframe_types::chat::ChatMessage;
use serde_json::json;
use std::sync::Arc;

#[test]
fn optional_decoder_is_used_by_full_and_incremental_conversion() {
    let raw: Vec<ChatMessage> = serde_json::from_value(json!([{
        "id":"m", "chatId":"c", "type":"assistant", "timestamp":"t",
        "content":[{"type":"text", "text":"<mainframe-command-response id=\"x\">visible</mainframe-command-response>"}]
    }])).unwrap();
    let noop = prepare_messages_with_decoders(&raw, None, &NoopDecoders);
    assert!(
        serde_json::to_string(&noop)
            .unwrap()
            .contains("mainframe-command-response")
    );
    let decoded = prepare_messages_with_decoders(&raw, None, &MainframeDecoders);
    assert_eq!(
        serde_json::to_value(&decoded[0].content).unwrap()[0]["text"],
        "visible"
    );
    let mut projector = IncrementalProjector::with_decoders(Arc::new(MainframeDecoders));
    let changes = RawChanges::default();
    let delta = projector.project(ProjectionInput {
        raw: &raw,
        overlay: None,
        categories: None,
        changes,
    });
    assert_eq!(delta.snapshot.materialize(), decoded);
}

#[test]
fn segment_decoder_selection_survives_append_overlay_and_rewind() {
    use mainframe_display::{ToolResultDecoders, decoders::DecoderSet};
    let set = Arc::new(DecoderSet::new(
        "first".into(),
        [
            (
                "first".into(),
                Arc::new(NoopDecoders) as Arc<dyn ToolResultDecoders>,
            ),
            (
                "second".into(),
                Arc::new(MainframeDecoders) as Arc<dyn ToolResultDecoders>,
            ),
        ]
        .into(),
    ));
    let divider: ChatMessage = serde_json::from_value(json!({"id":"divider","chatId":"c","type":"system","timestamp":"t","content":[{"type":"provider_switch","marker":{
        "segmentId":"s2", "kind":"provider_switch", "fromAdapterId":"first", "toAdapterId":"second", "fromAdapterName":"First", "toAdapterName":"Second", "resumed":false,
        "previous":{"adapterId":"first","turnCount":0,"totalCost":0,"totalTokensInput":0,"totalTokensOutput":0}
    }}]})).unwrap();
    let raw = vec![message("before"), divider, message("after")];
    let expected = prepare_messages_with_decoders(&raw, None, set.as_ref());
    assert!(
        serde_json::to_string(&expected[0])
            .unwrap()
            .contains("mainframe-command-response")
    );
    assert!(
        !serde_json::to_string(&expected[2])
            .unwrap()
            .contains("mainframe-command-response")
    );
    assert_incremental_routes(set, raw, expected);
}

fn message(id: &str) -> ChatMessage {
    let wrapped = "<mainframe-command-response id=\"x\">visible</mainframe-command-response>";
    serde_json::from_value(json!({"id":id,"chatId":"c","type":"assistant","timestamp":"t","content":[{"type":"text","text":wrapped}]})).unwrap()
}

fn assert_incremental_routes(
    set: Arc<dyn mainframe_display::ToolResultDecoders>,
    raw: Vec<ChatMessage>,
    expected: Vec<mainframe_types::display::DisplayMessage>,
) {
    use mainframe_display::RawChange;
    let mut projector = IncrementalProjector::with_decoders(set);
    for end in 1..=raw.len() {
        let delta = projector.project(ProjectionInput {
            raw: &raw[..end],
            overlay: None,
            categories: None,
            changes: [RawChange::Appended].into_iter().collect(),
        });
        if end == raw.len() {
            assert_eq!(delta.snapshot.materialize(), expected);
        }
    }
    let overlay = message("overlay");
    let delta = projector.project(ProjectionInput {
        raw: &raw,
        overlay: Some(&overlay),
        categories: None,
        changes: RawChanges::new(),
    });
    assert!(
        !serde_json::to_string(delta.snapshot.materialize().last().unwrap())
            .unwrap()
            .contains("mainframe-command-response")
    );
    let rewound = vec![message("before"), message("after")];
    let delta = projector.project(ProjectionInput {
        raw: &rewound,
        overlay: None,
        categories: None,
        changes: [RawChange::Structural(1)].into_iter().collect(),
    });
    assert!(
        serde_json::to_string(&delta.snapshot.materialize())
            .unwrap()
            .contains("mainframe-command-response")
    );
}
