//! Server-side coalescing for the diff engine's output (todo #350, plan
//! task 13) so fan-out volume stays bounded (spec decision 14) without this
//! crate owning a timer — a pure decision function over an explicit clock
//! (`now_ms`), so it stays unit-testable without a socket; `mainframe-server`
//! owns the real ticker that calls it.

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::update::SessionUpdate;

/// One frame in the throttle's FIFO: a diff-engine update, coalescible, or an
/// opaque out-of-band notification (a gate raise, a queue snapshot, …) that
/// rides the same queue so it cannot overtake still-buffered content it
/// depends on (R2.11) — never coalesced, since its meaning is not a delta.
#[derive(Debug, Clone, PartialEq)]
pub enum ThrottledFrame {
    Update(SessionUpdate),
    Raw(String),
}

/// One session's throttle state: when it last flushed, and what is buffered
/// since then.
pub struct Throttle {
    interval_ms: i64,
    last_flush_ms: Option<i64>,
    pending: Vec<ThrottledFrame>,
}

impl Throttle {
    pub fn new(interval_ms: i64) -> Self {
        Self {
            interval_ms,
            last_flush_ms: None,
            pending: Vec::new(),
        }
    }

    /// Feed one diff-engine update in. Returns the frames to send now — empty
    /// while the window is still open (the update is buffered, not lost).
    /// The first call always flushes (no prior `last_flush_ms` to compare
    /// against), so a session's opening frame is never delayed.
    pub fn push(&mut self, now_ms: i64, update: SessionUpdate) -> Vec<ThrottledFrame> {
        self.push_frame(now_ms, ThrottledFrame::Update(update))
    }

    /// Feed one raw out-of-band frame in, through the same FIFO as content
    /// updates (R2.11) — never coalesced, but never allowed to jump ahead of
    /// an update already queued in front of it either.
    pub fn push_raw(&mut self, now_ms: i64, frame: String) -> Vec<ThrottledFrame> {
        self.push_frame(now_ms, ThrottledFrame::Raw(frame))
    }

    fn push_frame(&mut self, now_ms: i64, frame: ThrottledFrame) -> Vec<ThrottledFrame> {
        self.pending.push(frame);
        let due = self
            .last_flush_ms
            .is_none_or(|last| now_ms - last >= self.interval_ms);
        if !due {
            return Vec::new();
        }
        self.last_flush_ms = Some(now_ms);
        coalesce(std::mem::take(&mut self.pending))
    }

    /// Drain whatever the window is still holding, coalesced. `push` only
    /// flushes when a *later* update arrives after the window elapses, so a
    /// trailing burst would otherwise sit buffered forever — the socket
    /// loop's periodic flush tick calls this to bound that tail latency.
    pub fn flush(&mut self, now_ms: i64) -> Vec<ThrottledFrame> {
        if self.pending.is_empty() {
            return Vec::new();
        }
        self.last_flush_ms = Some(now_ms);
        coalesce(std::mem::take(&mut self.pending))
    }
}

/// Merge same-id consecutive chunk frames by concatenating their deltas —
/// the only case that can multiply frame count without changing meaning.
/// Non-chunk updates (upserts, tool-call patches) and raw frames pass
/// through unmerged: each already carries the full information for its
/// revision, and a raw frame additionally blocks the merge chain across it,
/// preserving its position relative to the updates on either side.
fn coalesce(frames: Vec<ThrottledFrame>) -> Vec<ThrottledFrame> {
    let mut merged: Vec<ThrottledFrame> = Vec::with_capacity(frames.len());
    for frame in frames {
        let ThrottledFrame::Update(update) = &frame else {
            merged.push(frame);
            continue;
        };
        if try_merge_chunk(last_update_mut(&mut merged), update) {
            continue;
        }
        merged.push(frame);
    }
    merged
}

fn last_update_mut(merged: &mut [ThrottledFrame]) -> Option<&mut SessionUpdate> {
    match merged.last_mut()? {
        ThrottledFrame::Update(update) => Some(update),
        ThrottledFrame::Raw(_) => None,
    }
}

/// If `last` and `update` are same-id chunks of the same message kind,
/// concatenate `update`'s delta onto `last` in place and report the merge.
fn try_merge_chunk(last: Option<&mut SessionUpdate>, update: &SessionUpdate) -> bool {
    let Some(last) = last else {
        return false;
    };
    // Kind check first, on an immutable reborrow that ends before the
    // mutable borrow below starts — `last` and `update` are never the same
    // enum variant's payload aliased twice.
    if !same_chunk_kind(last, update) {
        return false;
    }
    let Some((update_id, update_delta)) = chunk_parts(update) else {
        return false;
    };
    let Some((last_id, last_text)) = chunk_parts_mut(last) else {
        return false;
    };
    if last_id != update_id {
        return false;
    }
    last_text.push_str(update_delta);
    true
}

fn same_chunk_kind(a: &SessionUpdate, b: &SessionUpdate) -> bool {
    matches!(
        (a, b),
        (
            SessionUpdate::AgentMessageChunk(_),
            SessionUpdate::AgentMessageChunk(_)
        ) | (
            SessionUpdate::UserMessageChunk(_),
            SessionUpdate::UserMessageChunk(_)
        ) | (
            SessionUpdate::AgentThoughtChunk(_),
            SessionUpdate::AgentThoughtChunk(_)
        )
    )
}

/// Only text chunks merge — an image chunk appends a whole block, so
/// concatenation has no meaning for it (and an image sitting between two
/// text chunks correctly blocks their merge, since merging is
/// adjacent-only).
fn chunk_parts(update: &SessionUpdate) -> Option<(&str, &str)> {
    let chunk = match update {
        SessionUpdate::AgentMessageChunk(c)
        | SessionUpdate::UserMessageChunk(c)
        | SessionUpdate::AgentThoughtChunk(c) => c,
        _ => return None,
    };
    match &chunk.content {
        ContentBlock::Text { text, .. } => Some((&chunk.message_id, text.as_str())),
        _ => None,
    }
}

fn chunk_parts_mut(update: &mut SessionUpdate) -> Option<(&str, &mut String)> {
    let chunk = match update {
        SessionUpdate::AgentMessageChunk(c)
        | SessionUpdate::UserMessageChunk(c)
        | SessionUpdate::AgentThoughtChunk(c) => c,
        _ => return None,
    };
    match &mut chunk.content {
        ContentBlock::Text { text, .. } => Some((&chunk.message_id, text)),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
