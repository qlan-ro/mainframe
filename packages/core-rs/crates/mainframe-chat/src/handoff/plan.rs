//! Which earlier segments a segment's handoff covers, and how (`delta` into a
//! returning native session, or `full` into a fresh one).

use mainframe_types::segment::{HandoffStrategy, SegmentKind, SegmentLayout, SegmentRecord};

use super::budget::MIN_DELTA_BUDGET;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coverage {
    pub strategy: HandoffStrategy,
    /// Ordinals of the covered segments, ascending.
    pub ordinals: Vec<u32>,
}

impl Coverage {
    pub fn from_ordinal(&self) -> u32 {
        self.ordinals.first().copied().unwrap_or(0)
    }

    pub fn to_ordinal(&self) -> u32 {
        self.ordinals.last().copied().unwrap_or(0)
    }
}

/// `None` when the segment needs no handoff: the chat's first segment, a
/// context reset (same provider, deliberately fresh), or nothing to cover.
/// `transcript_present` is the target native session's resumability.
pub fn plan_coverage(
    layout: &SegmentLayout,
    target: &SegmentRecord,
    transcript_present: bool,
) -> Option<Coverage> {
    if target.kind == SegmentKind::ContextReset || target.ordinal == 0 {
        return None;
    }
    let native = layout.native(&target.native_session_ref)?;
    let resumable = native.native_session_id.is_some()
        && native.borrowed_from_chat_id.is_none()
        && transcript_present;
    // The last earlier segment this native session took part in; without
    // one the session has seen nothing of this chat, so it gets everything.
    let last_seen = layout
        .segments
        .iter()
        .filter(|s| s.native_session_ref == native.id && s.ordinal < target.ordinal)
        .map(|s| s.ordinal)
        .max()
        .filter(|_| resumable);
    let coverage = match last_seen {
        Some(last_seen) => Coverage {
            strategy: HandoffStrategy::Delta,
            ordinals: ordinals_between(layout, Some(last_seen), target.ordinal),
        },
        None => full_coverage(layout, target),
    };
    (!coverage.ordinals.is_empty()).then_some(coverage)
}

/// Every earlier segment, borrowed ones included.
pub fn full_coverage(layout: &SegmentLayout, target: &SegmentRecord) -> Coverage {
    Coverage {
        strategy: HandoffStrategy::Full,
        ordinals: ordinals_between(layout, None, target.ordinal),
    }
}

fn ordinals_between(layout: &SegmentLayout, after: Option<u32>, before: u32) -> Vec<u32> {
    layout
        .segments
        .iter()
        .map(|s| s.ordinal)
        .filter(|o| after.is_none_or(|a| *o > a) && *o < before)
        .collect()
}

/// Whether a delta budget is too small to be worth sending, in which case
/// the target starts a fresh native session with a full handoff instead.
pub fn needs_fresh_fallback(coverage: &Coverage, delta_budget: u64) -> bool {
    coverage.strategy == HandoffStrategy::Delta && delta_budget < MIN_DELTA_BUDGET
}
