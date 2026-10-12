#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]
// Capture at 5cb0933b: copy fixtures/display/capture_base.rs to the base worktree's
// crates/mainframe-server/tests/r2_capture.rs, seed its target, then from packages/core-rs:
// CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 R2_GOLDEN_DIR=<absolute fixtures/display> cargo test -p mainframe-server --test r2_capture
// Claude inputs combine baseline ask-question/task-subagent/todo-write/composer-attachments recordings
// with slash-command and TaskProgress cases; mock uses text-tool-text-stream. Codex uses thread/read shapes.
use mainframe_display::decoders::{DecoderSet, MainframeDecoders};
use mainframe_display::display_pipeline::prepare_messages_with_decoders;
use mainframe_display::incremental::IncrementalProjector;
use mainframe_display::{DisplayProjector, ProjectionInput, RawChange, RawChanges};
use mainframe_types::{chat::ChatMessage, display::ToolCategories};
use std::sync::Arc;

#[test]
fn baseline_transcript_presentation_bytes() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/display");
    for provider in ["claude", "codex", "mock"] {
        let raw: Vec<ChatMessage> = serde_json::from_slice(
            &std::fs::read(root.join(format!("{provider}.raw.json"))).unwrap(),
        )
        .unwrap();
        let categories: ToolCategories = serde_json::from_slice(
            &std::fs::read(root.join(format!("{provider}.categories.json"))).unwrap(),
        )
        .unwrap();
        let decoders = Arc::new(DecoderSet::new(
            provider.into(),
            [(
                provider.into(),
                Arc::new(MainframeDecoders) as Arc<dyn mainframe_display::ToolResultDecoders>,
            )]
            .into(),
        ));
        let expected = std::fs::read(root.join(format!("{provider}.display.golden"))).unwrap();
        let full = prepare_messages_with_decoders(&raw, Some(&categories), decoders.as_ref());
        assert_eq!(bytes(&full), expected, "{provider} full");
        let mut projector = IncrementalProjector::with_decoders(decoders);
        let mut actual = Vec::new();
        for end in 1..=raw.len() {
            actual = projector
                .project(ProjectionInput {
                    raw: &raw[..end],
                    overlay: None,
                    categories: Some(&categories),
                    changes: [RawChange::Appended].into_iter().collect::<RawChanges>(),
                })
                .snapshot
                .materialize();
        }
        assert_eq!(bytes(&actual), expected, "{provider} incremental");
    }
}

fn bytes(value: &impl serde::Serialize) -> Vec<u8> {
    serde_json::to_vec_pretty(&serde_json::to_value(value).unwrap()).unwrap()
}
