//! Provider segments of a chat: one chat, many provider-native sessions.
//!
//! The wire types here are mirrored in `packages/types/src/segment.ts`. The
//! daemon-internal rows live in `segment_records.rs` and are re-exported.

use serde::{Deserialize, Serialize};

use crate::chat::SessionTuning;

pub use crate::segment_records::*;

/// Why a segment started.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SegmentKind {
    #[default]
    Initial,
    ProviderSwitch,
    ContextReset,
}

impl SegmentKind {
    pub fn as_db_str(self) -> &'static str {
        match self {
            Self::Initial => "initial",
            Self::ProviderSwitch => "provider_switch",
            Self::ContextReset => "context_reset",
        }
    }

    pub fn from_db_str(value: &str) -> Self {
        match value {
            "provider_switch" => Self::ProviderSwitch,
            "context_reset" => Self::ContextReset,
            _ => Self::Initial,
        }
    }
}

/// Whether a handoff carries only what the target missed, or the whole chat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HandoffStrategy {
    Delta,
    Full,
}

impl HandoffStrategy {
    pub fn as_db_str(self) -> &'static str {
        match self {
            Self::Delta => "delta",
            Self::Full => "full",
        }
    }

    pub fn from_db_str(value: &str) -> Self {
        if value == "delta" {
            Self::Delta
        } else {
            Self::Full
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HandoffStatus {
    Pending,
    Delivered,
    Superseded,
}

impl HandoffStatus {
    pub fn as_db_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Delivered => "delivered",
            Self::Superseded => "superseded",
        }
    }

    pub fn from_db_str(value: &str) -> Self {
        match value {
            "delivered" => Self::Delivered,
            "superseded" => Self::Superseded,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffSummary {
    pub id: String,
    pub strategy: HandoffStrategy,
    pub status: HandoffStatus,
    pub item_count: u32,
    pub omitted_count: u32,
    pub fell_back_to_fresh: bool,
}

/// The totals of the segment a switch closed, shown in the divider's hint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SegmentTotals {
    pub adapter_id: String,
    pub model: Option<String>,
    pub turn_count: u32,
    pub total_cost: f64,
    pub total_tokens_input: i64,
    pub total_tokens_output: i64,
}

/// The divider a segment after the first opens with.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSwitchMarker {
    pub segment_id: String,
    pub kind: SegmentKind,
    pub from_adapter_id: String,
    pub to_adapter_id: String,
    /// Display names, so clients without an adapter registry (and the text
    /// fallback older clients render) can name both providers.
    pub from_adapter_name: String,
    pub to_adapter_name: String,
    pub to_model: Option<String>,
    /// True when the segment returns to a native session the chat used before.
    pub resumed: bool,
    pub previous: SegmentTotals,
    pub handoff: Option<HandoffSummary>,
}

/// `GET /api/chats/{id}/segments` row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSegment {
    pub id: String,
    pub ordinal: u32,
    pub kind: SegmentKind,
    pub adapter_id: String,
    pub model: Option<String>,
    pub borrowed: bool,
    pub native_session_id: Option<String>,
    pub turn_count: u32,
    pub total_cost: f64,
    pub total_tokens_input: i64,
    pub total_tokens_output: i64,
    pub created_at: String,
    pub closed_at: Option<String>,
    pub handoff: Option<HandoffSummary>,
}

/// `POST /api/chats/{id}/switch-provider` body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SwitchProviderRequest {
    pub adapter_id: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub tuning: Option<SessionTuning>,
}

impl ProviderSwitchMarker {
    /// The divider's one-line label; also the plain-text fallback that
    /// clients without provider-switch rendering show.
    pub fn label(&self) -> String {
        let to = &self.to_adapter_name;
        if self.kind == SegmentKind::ContextReset {
            return format!("New {to} session · earlier context cleared");
        }
        let Some(handoff) = &self.handoff else {
            return if self.resumed {
                format!("Back to {to} · resumes its earlier session with your next message")
            } else {
                format!("Switched to {to} · context hands off with your next message")
            };
        };
        let counts = handoff_counts(handoff.item_count, handoff.omitted_count);
        if handoff.fell_back_to_fresh {
            format!("Back to {to} · new session · context handed off ({counts})")
        } else if self.resumed {
            format!("Back to {to} · resumed earlier session · caught up ({counts})")
        } else {
            format!("Switched to {to} · context handed off ({counts})")
        }
    }
}

/// "3 items" / "1 item, 2 omitted" — the omitted part is dropped at zero.
pub fn handoff_counts(items: u32, omitted: u32) -> String {
    let noun = if items == 1 { "item" } else { "items" };
    if omitted == 0 {
        format!("{items} {noun}")
    } else {
        format!("{items} {noun}, {omitted} omitted")
    }
}
