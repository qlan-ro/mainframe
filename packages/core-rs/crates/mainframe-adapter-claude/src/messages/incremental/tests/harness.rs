//! Shared equivalence-test fixtures: after every step, both the projector's
//! materialized snapshot and a mirror built purely by replaying emitted deltas
//! must equal a fresh `prepare_messages_for_client` call — the ground truth the
//! incremental projector must never drift from.

use std::collections::HashMap;

use mainframe_display::{DisplayProjector, ProjectionInput, RawChanges};
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::display::{DisplayMessage, ToolCategories};
use serde_json::Value;

use crate::messages::display_pipeline::prepare_messages_for_client;
use crate::messages::incremental::IncrementalProjector;

pub(super) struct Harness {
    pub(super) raw: Vec<ChatMessage>,
    projector: IncrementalProjector,
    mirror: Vec<DisplayMessage>,
    categories: Option<ToolCategories>,
    seq: u64,
}

impl Harness {
    pub(super) fn new() -> Self {
        Self {
            raw: Vec::new(),
            projector: IncrementalProjector::new(),
            mirror: Vec::new(),
            categories: None,
            seq: 0,
        }
    }

    pub(super) fn with_categories(categories: ToolCategories) -> Self {
        Self {
            categories: Some(categories),
            ..Self::new()
        }
    }

    pub(super) fn set_categories(&mut self, categories: ToolCategories) {
        self.categories = Some(categories);
    }

    pub(super) fn next_id(&mut self) -> String {
        self.seq += 1;
        format!("m{:05}", self.seq)
    }

    /// Run one `project` call over the current `raw`/overlay with `changes`,
    /// then assert both the snapshot and the delta-replayed mirror equal a
    /// fresh full-pipeline run.
    pub(super) fn step(&mut self, changes: RawChanges, overlay: Option<&ChatMessage>) {
        let delta = self.projector.project(ProjectionInput {
            raw: &self.raw,
            changes,
            overlay,
            categories: self.categories.as_ref(),
        });
        let snapshot_now = delta.snapshot.materialize();
        if delta.full {
            self.mirror = snapshot_now.clone();
        } else {
            if self.mirror.len() > delta.len {
                self.mirror.truncate(delta.len);
            }
            for (ordinal, message) in &delta.changes {
                if *ordinal < self.mirror.len() {
                    self.mirror[*ordinal] = message.clone();
                } else {
                    self.mirror.push(message.clone());
                }
            }
        }
        self.assert_matches_full_pipeline(&snapshot_now, overlay);
    }

    /// Mirrors `project_display` (`mainframe-chat/event_handler/display_projection.rs`):
    /// the overlay, when present, is appended as a synthetic tail message
    /// before running the full pipeline — the ground truth this projector
    /// must stay equivalent to.
    fn assert_matches_full_pipeline(
        &self,
        snapshot_now: &[DisplayMessage],
        overlay: Option<&ChatMessage>,
    ) {
        let mut combined: Vec<ChatMessage> = self.raw.clone();
        if let Some(overlay) = overlay {
            combined.push(overlay.clone());
        }
        let expected = prepare_messages_for_client(&combined, self.categories.as_ref());
        assert_eq!(
            self.mirror, expected,
            "delta-replayed mirror diverged from the full pipeline"
        );
        assert_eq!(
            snapshot_now,
            &expected[..],
            "projector snapshot diverged from the full pipeline"
        );
    }
}

pub(super) fn user(id: &str, text: &str) -> ChatMessage {
    text_msg(id, ChatMessageType::User, text)
}

pub(super) fn assistant(id: &str, content: Vec<MessageContent>) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c".to_string(),
        r#type: ChatMessageType::Assistant,
        content,
        timestamp: timestamp(id),
        metadata: None,
    }
}

pub(super) fn tool_result_msg(id: &str, content: Vec<MessageContent>) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c".to_string(),
        r#type: ChatMessageType::ToolResult,
        content,
        timestamp: timestamp(id),
        metadata: None,
    }
}

pub(super) fn duration_marker(id: &str, ms: u64) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c".to_string(),
        r#type: ChatMessageType::System,
        content: Vec::new(),
        timestamp: timestamp(id),
        metadata: Some(HashMap::from([(
            "turnDurationMs".to_string(),
            Value::from(ms),
        )])),
    }
}

fn text_msg(id: &str, t: ChatMessageType, text: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c".to_string(),
        r#type: t,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: text.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: timestamp(id),
        metadata: None,
    }
}

fn timestamp(id: &str) -> String {
    format!("2026-01-01T00:00:00.{id}Z")
}

pub(super) fn text(text: &str) -> MessageContent {
    MessageContent::Leaf(LeafContent::Text {
        text: text.to_string(),
        parent_tool_use_id: None,
    })
}

pub(super) fn tool_use(id: &str, name: &str) -> MessageContent {
    tool_use_with_input(id, name, HashMap::new())
}

pub(super) fn tool_use_with_input(
    id: &str,
    name: &str,
    input: HashMap<String, Value>,
) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolUse {
        timing: None,
        command_execution: None,
        id: id.to_string(),
        name: name.to_string(),
        input,
        parent_tool_use_id: None,
    })
}

pub(super) fn tool_use_with_parent(id: &str, name: &str, parent: &str) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolUse {
        timing: None,
        command_execution: None,
        id: id.to_string(),
        name: name.to_string(),
        input: HashMap::new(),
        parent_tool_use_id: Some(parent.to_string()),
    })
}

pub(super) fn tool_result(id: &str, content: &str) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: id.to_string(),
        content: content.to_string(),
        is_error: false,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        images: Vec::new(),
        parent_tool_use_id: None,
    })
}

/// Mutate an existing `ToolUse` block in place to carry `timing` — simulates
/// the cache writing a completed timing onto the stored raw content.
pub(super) fn set_tool_use_timing(
    block: &mut MessageContent,
    timing: mainframe_types::tool_call_timing::ToolCallTiming,
) {
    if let MessageContent::Node(MessageContentNode::ToolUse { timing: slot, .. }) = block {
        *slot = Some(timing);
    }
}

pub(super) fn task_categories() -> ToolCategories {
    serde_json::from_value(serde_json::json!({
        "explore": [],
        "hidden": [],
        "progress": ["TaskCreate", "TaskUpdate"],
        "subagent": ["Task"],
    }))
    .expect("static fixture categories")
}
