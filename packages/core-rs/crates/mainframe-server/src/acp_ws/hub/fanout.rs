//! Per-event fan-out: who receives a chat-surface event, and the critical
//! section it is delivered in (todo #350, T5/T6). Every helper here computes
//! its frames and sends them inside the SAME `locked_sessions()` guard
//! (R1.2), so a diff can never be computed under the lock and enqueued after
//! it, where a second diff for the same session could interleave ahead of it.

use std::sync::Arc;

use mainframe_acp::stream::SessionStream;
use mainframe_acp::{EncodedItem, ThrottledFrame};
use serde::Serialize;
use tracing::warn;

use super::super::facade_conn::{FacadeConnection, SessionSlot};
use super::{FacadeHub, now_ms};

impl FacadeHub {
    pub(super) fn attached_connections(&self, chat_id: &str) -> Vec<Arc<FacadeConnection>> {
        self.connections
            .iter()
            .filter(|entry| entry.value().is_attached(chat_id))
            .map(|entry| Arc::clone(entry.value()))
            .collect()
    }

    /// Run `per_stream` against every attached, SEEDED session and send its
    /// updates — diff and publish inside the same per-connection lock (T5,
    /// R1.2), so a diff can never be computed under the lock and enqueued
    /// after it, where a second diff for the same session could interleave
    /// ahead of it. A session still `AwaitingSeed` (a resume in flight) is
    /// skipped here, same as an unattached one — only
    /// [`Self::on_display_revision`] buffers for that state.
    pub(super) fn for_each_attached_session(
        &self,
        chat_id: &str,
        mut per_stream: impl FnMut(&mut SessionStream, i64) -> Vec<ThrottledFrame>,
    ) {
        let now = now_ms();
        for connection in self.attached_connections(chat_id) {
            let mut sessions = connection.locked_sessions();
            if let Some(SessionSlot::Live(stream)) = sessions.get_mut(chat_id) {
                for frame in per_stream(stream, now) {
                    connection.send_throttled(chat_id, frame);
                }
            }
        }
    }

    /// [`ChatSurfaceEvent::DisplayRevision`]'s handler: unlike the other
    /// event kinds, a connection `AwaitingSeed` for this chat must not be
    /// skipped — its latest item snapshot is buffered so
    /// [`Self::reset_session`] can diff it against the seed it is about to
    /// receive (T5, R2.9), instead of the revision vanishing for a
    /// reconnecting client.
    pub(super) fn on_display_revision(&self, chat_id: &str, items: &[EncodedItem]) {
        let now = now_ms();
        for connection in self.attached_connections(chat_id) {
            let mut sessions = connection.locked_sessions();
            match sessions.get_mut(chat_id) {
                Some(SessionSlot::Live(stream)) => {
                    for frame in stream.on_revision(items, now) {
                        connection.send_throttled(chat_id, frame);
                    }
                }
                Some(SessionSlot::AwaitingSeed { latest, .. }) => {
                    *latest = Some(items.to_vec());
                }
                None => {}
            }
        }
    }

    /// Serialize one out-of-band notification and fan it out. Serializing a
    /// frame the daemon just built does not fail in practice, but dropping it
    /// silently would leave no trace of why the client never saw it.
    pub(super) fn push_notification<T: Serialize>(
        &self,
        chat_id: &str,
        note: &T,
        kind: RawFrameKind,
    ) {
        match serde_json::to_string(note) {
            Ok(payload) => self.push_raw_to_attached(chat_id, payload, kind),
            Err(err) => warn!(
                %err,
                chat_id,
                kind = kind.label(),
                "acp facade: failed to serialize an out-of-band notification"
            ),
        }
    }

    /// A raw out-of-band notification (a gate raise, queue snapshot,
    /// transcript clear, compaction phase) for every attached connection —
    /// through the SAME per-session throttle FIFO content updates ride
    /// (R2.11), so it cannot arrive ahead of a still-buffered update it
    /// depends on. A connection mid-resume has no seeded stream to queue
    /// against, so its frames are buffered in the slot and drained by
    /// [`Self::reset_session`] behind the replay instead.
    pub(super) fn push_raw_to_attached(&self, chat_id: &str, payload: String, kind: RawFrameKind) {
        let now = now_ms();
        for connection in self.attached_connections(chat_id) {
            let mut sessions = connection.locked_sessions();
            match sessions.get_mut(chat_id) {
                Some(SessionSlot::Live(stream)) => {
                    for frame in stream.push_raw(payload.clone(), now) {
                        connection.send_throttled(chat_id, frame);
                    }
                }
                Some(SessionSlot::AwaitingSeed { raws, .. }) if kind.outlives_a_replay() => {
                    raws.push(payload.clone());
                }
                // Either a clear the imminent replay already reflects, or a
                // chat this connection dropped between the snapshot
                // `attached_connections` took and this lock — nothing to
                // deliver either way. /* expected */
                _ => {}
            }
        }
    }
}

/// What kind of raw frame `push_raw_to_attached` is carrying — the one thing
/// that differs between them once a resume is in flight.
#[derive(Clone, Copy)]
pub(super) enum RawFrameKind {
    Gate,
    QueueState,
    TranscriptCleared,
    Resync,
    Compaction,
}

impl RawFrameKind {
    /// The frame family, for logs.
    fn label(self) -> &'static str {
        match self {
            RawFrameKind::Gate => "gate",
            RawFrameKind::QueueState => "queue_state",
            RawFrameKind::TranscriptCleared => "transcript_cleared",
            RawFrameKind::Resync => "resync",
            RawFrameKind::Compaction => "compaction",
        }
    }

    /// Whether this frame still says something the resume's replay does not.
    /// A transcript clear does not: the snapshot already reflects the wipe,
    /// so delivering the clear behind the replay would erase the replay.
    fn outlives_a_replay(self) -> bool {
        !matches!(self, RawFrameKind::TranscriptCleared)
    }
}
