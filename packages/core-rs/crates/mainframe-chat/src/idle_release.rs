//! The idle history release: a chat nobody has viewed or used for the user's
//! idle time (`general` setting `historyRelease.idleMinutes`, default 10
//! minutes, or never) gives up its raw history, its projection and the facade's
//! revision log. Its registry cell, CLI session, permission state and worktree
//! offers stay, so the next send needs no respawn and the next view reloads
//! the history the way a first open does (`lifecycle_manager/release.rs`).
//!
//! The scanner (`idle_scanner.rs`) selects candidates; [`ChatRelease`]
//! re-checks each one under the offload claim and releases it. A chat is never
//! released while it is working or running a turn, holds a pending permission,
//! a queued prompt or an agent outbox entry, has a delegated task, a child
//! chat or a live background task, is due an idle compaction, is viewed by any
//! client, or keeps a history the transcript cannot give back (a temporary or
//! ephemeral chat, a missing transcript, an unsent fork).

use mainframe_types::sync::LockExt as _;
use std::sync::Arc;

use mainframe_adapter_api::{AdapterSession, BoxFuture};
use tracing::info;

use crate::chat_manager::Registry;
use crate::idle_scanner::idle_since;

pub(crate) type NowFn = Arc<dyn Fn() -> i64 + Send + Sync>;

/// The release half of the scan ([`ChatRelease`]): drops the
/// history of a chat nobody has viewed or used for the user's idle time while
/// the chat, its cell and its CLI session stay.
pub trait HistoryReleaser: Send + Sync {
    /// The idle time after which a chat's history goes; `None` when the user
    /// turned the release off.
    fn release_after_ms(&self) -> BoxFuture<'_, Option<i64>>;
    /// Whether the chat still holds a history to release.
    fn holds_history(&self, chat_id: &str) -> bool;
    /// Whether a client is viewing the chat right now.
    fn is_viewed(&self, chat_id: &str) -> bool;
    /// Re-check everything and release the chat's history, or do nothing. A
    /// chat used or viewed at or after `idle_before` (epoch ms) stays.
    fn release<'a>(&'a self, chat_id: &'a str, idle_before: i64) -> BoxFuture<'a, ()>;
}

/// When the scan last saw each chat on someone's screen: viewing counts as
/// use, so a chat the user just left waits out the whole idle time.
pub(crate) type SeenViewed = Arc<std::sync::Mutex<std::collections::HashMap<String, i64>>>;

/// The history release's idle clock: [`idle_since`], widened to the cell's
/// `last_used_at` even for a spawned session, so a load, a send or a history
/// read counts as use. `None` when the chat must never be considered idle.
pub fn release_idle_since(
    session: Option<&Arc<dyn AdapterSession>>,
    last_used_at: i64,
) -> Option<i64> {
    Some(idle_since(session, last_used_at)?.max(last_used_at))
}

/// Chats holding a history that nobody has viewed or used for longer than
/// `release_after_ms`. Records every chat seen on screen in `seen_viewed`, and
/// forgets chats that left the registry. The registry is read first and the
/// viewers asked after, so no registry lock is held across that call.
pub fn select_release_candidates(
    active_chats: &Registry,
    releaser: &dyn HistoryReleaser,
    seen_viewed: &std::sync::Mutex<std::collections::HashMap<String, i64>>,
    now: i64,
    release_after_ms: i64,
) -> Vec<String> {
    let cells: Vec<_> = active_chats
        .iter()
        .map(|entry| {
            let guard = entry.value().lock_recover();
            (
                entry.key().clone(),
                guard.session.clone(),
                guard.last_used_at,
            )
        })
        .collect();
    let mut seen = seen_viewed.lock_recover();
    seen.retain(|chat_id, _| active_chats.contains_key(chat_id));
    cells
        .into_iter()
        .filter_map(|(chat_id, session, last_used_at)| {
            if releaser.is_viewed(&chat_id) {
                seen.insert(chat_id, now);
                return None;
            }
            if !releaser.holds_history(&chat_id)
                || session
                    .as_ref()
                    .is_some_and(|s| s.is_spawned() || s.is_closing())
            {
                return None;
            }
            let viewed = seen.get(&chat_id).copied().unwrap_or(i64::MIN);
            let last = release_idle_since(session.as_ref(), last_used_at)?.max(viewed);
            (now - last > release_after_ms).then_some(chat_id)
        })
        .collect()
}

pub(crate) async fn release_registry(
    active_chats: &Registry,
    releaser: &dyn HistoryReleaser,
    seen_viewed: &std::sync::Mutex<std::collections::HashMap<String, i64>>,
    now: &NowFn,
) {
    let Some(release_after_ms) = releaser.release_after_ms().await else {
        return;
    };
    let now = now();
    let candidates =
        select_release_candidates(active_chats, releaser, seen_viewed, now, release_after_ms);
    for chat_id in candidates {
        info!(chat_id, "history release candidate");
        releaser.release(&chat_id, now - release_after_ms).await;
    }
}

mod release;
pub use release::ChatRelease;

#[cfg(test)]
#[path = "idle_release_tests.rs"]
mod tests;
