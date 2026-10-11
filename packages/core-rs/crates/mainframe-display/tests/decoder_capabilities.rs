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
fn decoder_sets_do_not_decode_the_same_wrapper_twice() {
    use mainframe_display::{ToolResultDecoders, decoders::DecoderSet};
    let set = DecoderSet(vec![
        Arc::new(MainframeDecoders),
        Arc::new(MainframeDecoders),
    ]);
    let text = "<mainframe-command-response id=\"outer\"><mainframe-command-response id=\"inner\">answer</mainframe-command-response></mainframe-command-response>";
    assert_eq!(
        set.strip_command_tags(text),
        MainframeDecoders.strip_command_tags(text)
    );
}
