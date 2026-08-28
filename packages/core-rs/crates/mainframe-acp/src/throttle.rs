//! Server-side coalescing for the diff engine's output (todo #350, plan
//! task 13) so fan-out volume stays bounded (spec decision 14) without this
//! crate owning a timer — a pure decision function over an explicit clock
//! (`now_ms`), so it stays unit-testable without a socket; `mainframe-server`
//! owns the real ticker that calls it.

use mainframe_types::acp::content::ContentBlock;
use mainframe_types::acp::update::SessionUpdate;

/// One session's throttle state: when it last flushed, and what is buffered
/// since then.
pub struct Throttle {
    interval_ms: i64,
    last_flush_ms: Option<i64>,
    pending: Vec<SessionUpdate>,
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
    pub fn push(&mut self, now_ms: i64, update: SessionUpdate) -> Vec<SessionUpdate> {
        self.pending.push(update);
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
    pub fn flush(&mut self, now_ms: i64) -> Vec<SessionUpdate> {
        if self.pending.is_empty() {
            return Vec::new();
        }
        self.last_flush_ms = Some(now_ms);
        coalesce(std::mem::take(&mut self.pending))
    }
}

/// Merge same-id consecutive chunk frames by concatenating their deltas —
/// the only case that can multiply frame count without changing meaning.
/// Non-chunk updates (upserts, tool-call patches) pass through unmerged: each
/// already carries the full information for its revision.
fn coalesce(updates: Vec<SessionUpdate>) -> Vec<SessionUpdate> {
    let mut merged: Vec<SessionUpdate> = Vec::with_capacity(updates.len());
    for update in updates {
        if try_merge_chunk(merged.last_mut(), &update) {
            continue;
        }
        merged.push(update);
    }
    merged
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

fn chunk_parts(update: &SessionUpdate) -> Option<(&str, &str)> {
    let chunk = match update {
        SessionUpdate::AgentMessageChunk(c)
        | SessionUpdate::UserMessageChunk(c)
        | SessionUpdate::AgentThoughtChunk(c) => c,
        _ => return None,
    };
    let ContentBlock::Text { text, .. } = &chunk.content;
    Some((&chunk.message_id, text.as_str()))
}

fn chunk_parts_mut(update: &mut SessionUpdate) -> Option<(&str, &mut String)> {
    let chunk = match update {
        SessionUpdate::AgentMessageChunk(c)
        | SessionUpdate::UserMessageChunk(c)
        | SessionUpdate::AgentThoughtChunk(c) => c,
        _ => return None,
    };
    let ContentBlock::Text { text, .. } = &mut chunk.content;
    Some((&chunk.message_id, text))
}

#[cfg(test)]
mod tests;
