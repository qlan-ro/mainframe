#![allow(clippy::unwrap_used, clippy::expect_used)]
use mainframe_display::display_pipeline::prepare_messages_for_client;
use mainframe_types::chat::ChatMessage;

#[test]
fn baseline_transcript_presentation_bytes() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/display");
    for provider in ["claude", "codex", "mock"] {
        let raw: Vec<ChatMessage> = serde_json::from_slice(
            &std::fs::read(root.join(format!("{provider}.raw.json"))).unwrap(),
        )
        .unwrap();
        let display = prepare_messages_for_client(&raw, None);
        let value = serde_json::to_value(display).unwrap();
        let bytes = serde_json::to_vec_pretty(&value).unwrap();
        let expected = root.join(format!("{provider}.display.golden"));
        assert_eq!(bytes, std::fs::read(expected).unwrap(), "{provider}");
    }
}
