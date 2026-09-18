//! Cache-eviction resync (todo #350, T20, R3.11): `MessageCache::append`
//! reports whether it dropped a message from the chat's front on this call —
//! when it did, an attached facade client's local accumulator has silently
//! diverged from what the cache still holds, and must re-resume rather than
//! trust the next delta. One call site per appender; kept out of
//! `event_handler.rs` so each grows by only the call itself.

use std::sync::Arc;

use crate::chat_surface::{self, ChatSurface, ChatSurfaceEvent};

/// Notify `surface` of an eviction-triggered resync for `chat_id`, a no-op
/// when `evicted` is false.
pub(crate) fn notify_if_evicted(
    surface: Option<&Arc<dyn ChatSurface>>,
    chat_id: &str,
    evicted: bool,
) {
    if evicted {
        chat_surface::notify(
            surface,
            ChatSurfaceEvent::Resync {
                chat_id: chat_id.to_string(),
            },
        );
    }
}
