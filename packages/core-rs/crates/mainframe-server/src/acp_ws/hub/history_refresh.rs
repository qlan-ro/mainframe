//! Keeps a chat's persisted history caches current after it runs a turn.
//!
//! A turn appends to the transcript, which makes the history snapshot and the
//! persisted first window stale, so the next daemon start would parse the
//! whole transcript again. Shortly after a turn ends this rewrites both from
//! the files on disk; at shutdown it finishes any refresh still pending.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, Weak};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use mainframe_chat::chat_manager::ChatManager;
use serde_json::Value;

use super::FacadeHub;
use super::history_tail::TailStore;
#[path = "history_refresh_tail.rs"]
mod tail;
use tail::write_tail;

/// Long enough for the CLI to finish writing the turn's last records, short
/// enough that quitting soon after a turn usually finds nothing left to do.
#[cfg(not(test))]
const REFRESH_DELAY: Duration = Duration::from_secs(2);
#[cfg(test)]
const REFRESH_DELAY: Duration = Duration::from_millis(50);

/// The least time between the starts of two refreshes of one chat. Each one
/// reparses the whole transcript and only the last is ever read, so a lane
/// finishing turns every few seconds must not reparse nonstop. A sooner turn
/// waits out the rest (a newer turn replaces it); shutdown ignores it.
#[cfg(not(test))]
const MIN_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
#[cfg(test)]
const MIN_REFRESH_INTERVAL: Duration = Duration::from_millis(400);

/// How long to wait before refreshing a chat whose turn just ended.
fn refresh_delay(last_started: Option<Instant>, now: Instant) -> Duration {
    let remaining = last_started
        .map(|started| (started + MIN_REFRESH_INTERVAL).saturating_duration_since(now))
        .unwrap_or_default();
    REFRESH_DELAY.max(remaining)
}

/// The first-window request a client last opened a chat with.
#[derive(Clone)]
pub(super) struct TailWindow {
    pub window: Value,
    pub previews: bool,
}

pub(crate) struct HistoryRefresher {
    manager: OnceLock<Weak<ChatManager>>,
    /// Chats with a turn ended since their caches were last written, keyed to
    /// the turn's ticket so a refresh never clears a newer turn's mark.
    stale: DashMap<String, u64>,
    tickets: AtomicU64,
    /// One refresh at a time: each holds a whole parsed transcript.
    running: tokio::sync::Mutex<()>,
    windows: DashMap<String, TailWindow>,
    /// When each chat's last refresh began, for [`MIN_REFRESH_INTERVAL`].
    started: DashMap<String, Instant>,
    /// Set once shutdown begins: nothing new starts after it.
    closing: AtomicBool,
    /// Fires when the shutdown budget is spent, to drop a refresh still running.
    cancel: tokio::sync::watch::Sender<bool>,
}

impl Default for HistoryRefresher {
    fn default() -> Self {
        Self {
            manager: OnceLock::new(),
            stale: DashMap::new(),
            tickets: AtomicU64::new(0),
            running: tokio::sync::Mutex::new(()),
            windows: DashMap::new(),
            started: DashMap::new(),
            closing: AtomicBool::new(false),
            cancel: tokio::sync::watch::channel(false).0,
        }
    }
}

impl FacadeHub {
    /// Gives the hub the manager it refreshes histories through. Weak: the
    /// manager already holds the hub as its chat surface.
    pub fn attach_history_refresh(&self, manager: &Arc<ChatManager>) {
        if self
            .history_refresh
            .manager
            .set(Arc::downgrade(manager))
            .is_err()
        {
            tracing::warn!("history refresh already attached");
        }
    }

    pub(super) fn remember_tail_window(&self, chat_id: &str, window: TailWindow) {
        self.history_refresh
            .windows
            .insert(chat_id.to_owned(), window);
    }

    pub(super) fn schedule_history_refresh(&self, chat_id: &str) {
        let refresher = Arc::clone(&self.history_refresh);
        if refresher.manager.get().is_none() || refresher.closing.load(Ordering::Acquire) {
            return;
        }
        let ticket = refresher.tickets.fetch_add(1, Ordering::Relaxed) + 1;
        refresher.stale.insert(chat_id.to_owned(), ticket);
        let delay = refresh_delay(refresher.started.get(chat_id).map(|at| *at), Instant::now());
        let store = self.history_tails.clone();
        let chat_id = chat_id.to_owned();
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            if refresher.stale.get(&chat_id).map(|t| *t) != Some(ticket) {
                return;
            }
            let mut cancelled = refresher.cancel.subscribe();
            tokio::select! {
                _ = cancelled.wait_for(|fired| *fired) => {}
                _ = refresher.run(&chat_id, store.as_deref()) => {}
            }
        });
    }

    #[cfg(test)]
    pub(super) fn history_refresh_started(&self, chat_id: &str) -> bool {
        self.history_refresh.started.contains_key(chat_id)
    }

    /// Forgets a deleted chat, so its entries do not outlive it and a refresh
    /// still waiting finds nothing to do.
    pub(super) fn forget_history_refresh(&self, chat_id: &str) {
        let refresher = &self.history_refresh;
        refresher.stale.remove(chat_id);
        refresher.windows.remove(chat_id);
        refresher.started.remove(chat_id);
    }

    /// Finishes every refresh still pending, within `budget`. Called once at
    /// shutdown, before the chat manager is disposed. Nothing refreshes after
    /// it starts, and a chat whose history is read through a spawned helper
    /// process (Codex) is left for the next start: a quitting app must not
    /// start processes. Whatever is still running when the budget ends is
    /// dropped.
    pub async fn flush_history_refreshes(&self, budget: Duration) {
        let refresher = &self.history_refresh;
        refresher.closing.store(true, Ordering::Release);
        let manager = refresher.manager.get().and_then(Weak::upgrade);
        let pending: Vec<String> = refresher
            .stale
            .iter()
            .map(|e| e.key().clone())
            .filter(|chat_id| {
                manager
                    .as_ref()
                    .is_some_and(|manager| !manager.history_refresh_spawns_process(chat_id))
            })
            .collect();
        let store = self.history_tails.as_deref();
        let flushed = tokio::time::timeout(budget, async {
            // Behind any refresh already running; none starts after this.
            let _turn = refresher.running.lock().await;
            for chat_id in &pending {
                refresher.refresh(chat_id, store).await;
            }
        })
        .await;
        refresher.cancel.send_replace(true);
        if flushed.is_err() {
            tracing::warn!(
                pending = pending.len(),
                "history refresh did not finish before shutdown"
            );
        }
    }
}

impl HistoryRefresher {
    async fn run(&self, chat_id: &str, store: Option<&TailStore>) {
        let _turn = self.running.lock().await;
        if self.closing.load(Ordering::Acquire) {
            return;
        }
        self.refresh(chat_id, store).await;
    }

    /// One refresh of `chat_id`; the caller holds the `running` slot.
    async fn refresh(&self, chat_id: &str, store: Option<&TailStore>) {
        let Some(ticket) = self.stale.get(chat_id).map(|t| *t) else {
            return;
        };
        let Some(manager) = self.manager.get().and_then(Weak::upgrade) else {
            return;
        };
        self.started.insert(chat_id.to_owned(), Instant::now());
        let refreshed = manager.refresh_history_cache(chat_id).await;
        if refreshed.is_none() && manager.is_chat_working(chat_id) {
            // A new turn started; its own end schedules the next refresh.
            return;
        }
        if let Some(refreshed) = refreshed
            && let Some(store) = store
        {
            let window = match self.windows.get(chat_id).map(|w| w.clone()) {
                Some(window) => Some(window),
                None => store.manifest(chat_id).await.map(|m| TailWindow {
                    window: m.window,
                    previews: m.previews,
                }),
            };
            if let Some(window) = window {
                write_tail(&manager, store, chat_id, window, refreshed).await;
            }
        }
        self.stale
            .remove_if(chat_id, |_, current| *current == ticket);
    }
}

#[cfg(test)]
#[path = "history_refresh_tests.rs"]
mod tests;
