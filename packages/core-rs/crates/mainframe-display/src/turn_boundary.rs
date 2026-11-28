//! Provider turn boundaries inside an assistant merge run.
//!
//! Consecutive assistant/tool_use messages normally merge into one display
//! container. When a hidden prompt (a filtered task notification, an omitted
//! Codex user item) separates two replies, nothing visible closes the run, so
//! the replies' text would concatenate. A message's turn key names the
//! provider turn it belongs to: the adapter-supplied `turnGroup` metadata, or
//! a top-level Codex presentation turn. A known key different from the open
//! run's last known key starts a new container. Unknown keys stay compatible
//! with either side, and tool results never split, so tool ownership holds.

use mainframe_types::chat::ChatMessage;
use mainframe_types::transcript_presentation::{
    PRESENTATION_CONTEXT_KEY, TURN_GROUP_KEY, TranscriptPresentation,
};
use serde::Deserialize as _;

use crate::message_grouping::is_assistant_or_tool_use;

/// The turn key of an assistant/tool_use message, when its provider knows it.
fn turn_key(msg: &ChatMessage) -> Option<String> {
    let meta = msg.metadata.as_ref()?;
    if let Some(key) = meta.get(TURN_GROUP_KEY) {
        return key
            .as_str()
            .filter(|key| !key.is_empty())
            .map(str::to_string);
    }
    let presentation =
        TranscriptPresentation::deserialize(meta.get(PRESENTATION_CONTEXT_KEY)?).ok()?;
    // A child context belongs to the parent tool call.
    (presentation.is_valid()
        && matches!(presentation.provider.as_str(), "claude" | "codex")
        && presentation.parent_tool_use_id.is_none())
    .then(|| format!("{}:{}", presentation.provider, presentation.turn_id))
}

/// The last known turn key of the open assistant merge run.
#[derive(Debug, Default, Clone)]
pub(crate) struct OpenTurn(Option<String>);

impl OpenTurn {
    /// Whether `msg` may join the open run. Only a known key that differs
    /// from the run's last known key is a boundary.
    pub(crate) fn admits(&self, msg: &ChatMessage) -> bool {
        if !is_assistant_or_tool_use(msg.r#type) {
            return true;
        }
        match (&self.0, turn_key(msg)) {
            (Some(open), Some(key)) => *open == key,
            _ => true,
        }
    }

    /// Record `msg` as part of the open run.
    pub(crate) fn observe(&mut self, msg: &ChatMessage) {
        if is_assistant_or_tool_use(msg.r#type)
            && let Some(key) = turn_key(msg)
        {
            self.0 = Some(key);
        }
    }

    /// A run that `msg` starts.
    pub(crate) fn starting_with(msg: &ChatMessage) -> Self {
        let mut turn = Self::default();
        turn.observe(msg);
        turn
    }
}
