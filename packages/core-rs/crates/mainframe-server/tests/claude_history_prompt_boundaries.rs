//! Reloaded Claude history keeps replies to hidden prompts apart (todo #394).
//!
//! The fixture is a synthetic Claude 2.1.280-shaped transcript: five hidden
//! `<task-notification>` prompts each produce the same session-limit reply,
//! and later hidden prompts produce progress replies. Nothing visible
//! separates those replies, so before prompt-group provenance the display
//! merged them into one container and ACP concatenated their text with no
//! separator. Both the full pipeline and the incremental projector must keep
//! each reply in its own container, with its text unchanged and tool results
//! still owned by the prompt that called the tools.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

use mainframe_acp::encoder::{EncodedItem, ItemRole, encode};
use mainframe_adapter_claude::history::load_history_in_dir;
use mainframe_display::display_pipeline::prepare_messages_for_client;
use mainframe_display::incremental::IncrementalProjector;
use mainframe_display::{DisplayProjector, ProjectionInput, RawChange, RawChanges};
use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::tool_call::ToolCallStatus;
use mainframe_types::chat::ChatMessage;

const SESSION: &str = "s-prompt-groups";
const FIXTURE: &str =
    include_str!("../../mainframe-adapter-claude/src/__fixtures__/hidden-prompt-groups.jsonl");
const LIMIT: &str = "You've hit your session limit · resets 4:20pm (Europe/Bucharest)";

async fn reload() -> Vec<ChatMessage> {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(format!("{SESSION}.jsonl")), FIXTURE).unwrap();
    load_history_in_dir(SESSION, &dir.path().to_string_lossy()).await
}

/// The text of every agent message item with text, in order (system
/// markers such as skill-loaded and compaction carry none).
fn agent_texts(items: &[EncodedItem]) -> Vec<String> {
    items
        .iter()
        .filter_map(|item| match item {
            EncodedItem::Message {
                role: ItemRole::Agent,
                content,
                ..
            } => Some(
                content
                    .iter()
                    .filter_map(|block| match block {
                        ContentBlock::Text { text, .. } => Some(text.as_str()),
                        _ => None,
                    })
                    .collect::<String>(),
            ),
            _ => None,
        })
        .filter(|text| !text.is_empty())
        .collect()
}

#[tokio::test]
async fn hidden_prompt_replies_reload_as_separate_acp_messages() {
    let raw = reload().await;
    let items = encode(&prepare_messages_for_client(&raw, None));
    assert_eq!(
        agent_texts(&items),
        [
            "Launching both checks.",
            "Both checks finished.",
            LIMIT,
            LIMIT,
            LIMIT,
            LIMIT,
            LIMIT,
            // The CLI gives a resume continuation the prompt id of the hidden
            // prompt it queued ahead of, so they form one prompt group.
            "No response requested.Progress: the build passed.",
            // An API error reply stays in its prompt's group.
            "Progress: the tests passed.Invalid API key · Please run /login",
            // Unknown ancestry joins the open group rather than guessing.
            "Updating the docs.Reply with a missing parent.Cycle one.Cycle two.",
            "Reply without an API id.",
            "After compaction.",
        ]
    );
    let completed_tools: Vec<_> = items
        .iter()
        .filter_map(|item| match item {
            EncodedItem::ToolCall { id, status, .. } if *status == ToolCallStatus::Completed => {
                Some(id.as_str())
            }
            _ => None,
        })
        .collect();
    assert_eq!(completed_tools, ["tu1", "tu2"]);
}

#[tokio::test]
async fn the_incremental_projector_matches_the_full_reload_pipeline() {
    let raw = reload().await;
    let expected = prepare_messages_for_client(&raw, None);
    let mut projector = IncrementalProjector::new();
    for len in 1..=raw.len() {
        let mut changes = RawChanges::new();
        changes.push(RawChange::Appended);
        projector.project(ProjectionInput {
            raw: &raw[..len],
            changes,
            overlay: None,
            categories: None,
        });
    }
    let delta = projector.project(ProjectionInput {
        raw: &raw,
        changes: RawChanges::new(),
        overlay: None,
        categories: None,
    });
    assert_eq!(delta.snapshot.materialize(), expected);
}
