//! Daemon-internal segment rows: what `mainframe-db` returns and stores, and
//! what `mainframe-chat` plans and composes history from. Never on the wire;
//! re-exported from `segment`.

use crate::chat::SessionTuning;
use crate::segment::{HandoffStatus, HandoffStrategy, HandoffSummary, SegmentKind};

// ── daemon-internal repository rows ─────────────────────────────────────────

/// One `chat_native_sessions` row.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct NativeSessionRecord {
    pub id: String,
    pub chat_id: String,
    pub adapter_id: String,
    pub native_session_id: Option<String>,
    pub session_file_path: Option<String>,
    pub borrowed_from_chat_id: Option<String>,
    pub model: Option<String>,
    pub tuning: Option<SessionTuning>,
    pub last_context_total_tokens: Option<u64>,
    pub last_context_max_tokens: Option<u64>,
    pub last_context_tokens_input: Option<i64>,
    pub transcript_missing: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// One `chat_segments` row.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SegmentRecord {
    pub id: String,
    pub chat_id: String,
    pub ordinal: u32,
    pub native_session_ref: String,
    pub kind: SegmentKind,
    pub start_marker: Option<String>,
    pub end_bound_message_id: Option<String>,
    pub end_bound_at: Option<String>,
    pub first_message_id: Option<String>,
    pub last_message_id: Option<String>,
    pub turn_count: u32,
    pub total_cost: f64,
    pub total_tokens_input: i64,
    pub total_tokens_output: i64,
    pub created_at: String,
    pub closed_at: Option<String>,
}

impl SegmentRecord {
    pub fn is_active(&self) -> bool {
        self.closed_at.is_none()
    }
}

/// One `chat_handoffs` row.
#[derive(Debug, Clone, PartialEq)]
pub struct HandoffRecord {
    pub id: String,
    pub chat_id: String,
    pub target_segment_id: String,
    pub strategy: HandoffStrategy,
    pub covered_from_ordinal: u32,
    pub covered_to_ordinal: u32,
    pub item_count: u32,
    pub omitted_count: u32,
    pub budget_bytes: u64,
    pub used_bytes: u64,
    pub fell_back_to_fresh: bool,
    pub status: HandoffStatus,
    pub created_at: String,
    pub delivered_at: Option<String>,
}

impl HandoffRecord {
    pub fn summary(&self) -> HandoffSummary {
        HandoffSummary {
            id: self.id.clone(),
            strategy: self.strategy,
            status: self.status,
            item_count: self.item_count,
            omitted_count: self.omitted_count,
            fell_back_to_fresh: self.fell_back_to_fresh,
        }
    }
}

/// Everything history composition and switch planning read about a chat's
/// segments, loaded in one repository call. Segments are in ordinal order.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SegmentLayout {
    pub segments: Vec<SegmentRecord>,
    pub natives: Vec<NativeSessionRecord>,
    /// Non-superseded handoffs (at most one per segment).
    pub handoffs: Vec<HandoffRecord>,
}

impl SegmentLayout {
    pub fn native(&self, id: &str) -> Option<&NativeSessionRecord> {
        self.natives.iter().find(|n| n.id == id)
    }

    pub fn active(&self) -> Option<&SegmentRecord> {
        self.segments.iter().find(|s| s.is_active())
    }

    pub fn handoff_for(&self, segment_id: &str) -> Option<&HandoffRecord> {
        self.handoffs
            .iter()
            .find(|h| h.target_segment_id == segment_id)
    }

    /// True when more than one segment exists — the only case that needs
    /// composition rather than a plain single-session load.
    pub fn is_multi_segment(&self) -> bool {
        self.segments.len() > 1
    }
}

// ── switch commit (planned in mainframe-chat, applied by mainframe-db) ─────

/// The chat settings a switch writes alongside the segment change.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SwitchSettings {
    pub adapter_id: String,
    pub model: Option<String>,
    pub permission_mode: Option<crate::settings::ExecutionMode>,
    pub plan_mode: bool,
    pub effort: Option<crate::adapter::EffortLevel>,
    pub fast: Option<bool>,
    pub ultracode: Option<bool>,
    pub adaptive_thinking: Option<bool>,
}

/// The pending, empty active segment a switch deletes instead of closing.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingDeletion {
    pub segment_id: String,
    /// Its native row, when no other segment runs on it.
    pub native_ref: Option<String>,
}

/// The active segment a switch closes, with the snapshot restored on return.
#[derive(Debug, Clone, PartialEq)]
pub struct ClosedSnapshot {
    pub segment_id: String,
    pub native_ref: String,
    pub model: Option<String>,
    pub tuning: Option<SessionTuning>,
}

/// Which native row a newly opened segment runs on.
#[derive(Debug, Clone, PartialEq)]
pub enum OpenNative {
    Existing(String),
    Fresh { id: String, adapter_id: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenSegment {
    pub id: String,
    pub ordinal: u32,
    pub kind: SegmentKind,
    pub native: OpenNative,
}

/// Everything one switch changes, applied by the segment repository in one
/// transaction (segments, native rows, and the `chats` mirror plus settings).
#[derive(Debug, Clone, PartialEq)]
pub struct SwitchCommit {
    pub chat_id: String,
    pub now: String,
    pub delete_pending: Option<PendingDeletion>,
    pub close_active: Option<ClosedSnapshot>,
    pub reactivate_segment_id: Option<String>,
    pub open_segment: Option<OpenSegment>,
    pub settings: SwitchSettings,
}
