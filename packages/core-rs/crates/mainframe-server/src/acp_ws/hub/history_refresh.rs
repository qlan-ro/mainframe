//! Keeps a chat's persisted history caches current after it runs a turn.
//!
//! A turn appends to the transcript, which makes the history snapshot and the
//! persisted first window stale, so the next daemon start would parse the
//! whole transcript again. Shortly after a turn ends this rewrites both from
//! the files on disk; at shutdown it finishes any refresh still pending.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, Weak};
use std::time::Duration;

use dashmap::DashMap;
use mainframe_acp::ResumeOptions;
use mainframe_acp::resume::persisted::PreparedHistoryTail;
use mainframe_acp::resume::{BoxFuture, ResumePort, ResumeSnapshot, SnapshotReader};
use mainframe_chat::chat_manager::{ChatManager, RefreshedHistory};
use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use mainframe_types::display::DisplayMessage;
use serde_json::{Value, json};

use super::FacadeHub;
use super::history_tail::{Manifest, TailStore, store};

/// Long enough for the CLI to finish writing the turn's last records, short
/// enough that quitting soon after a turn usually finds nothing left to do.
#[cfg(not(test))]
const REFRESH_DELAY: Duration = Duration::from_secs(2);
#[cfg(test)]
const REFRESH_DELAY: Duration = Duration::from_millis(50);

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
}

impl Default for HistoryRefresher {
    fn default() -> Self {
        Self {
            manager: OnceLock::new(),
            stale: DashMap::new(),
            tickets: AtomicU64::new(0),
            running: tokio::sync::Mutex::new(()),
            windows: DashMap::new(),
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
        if refresher.manager.get().is_none() {
            return;
        }
        let ticket = refresher.tickets.fetch_add(1, Ordering::Relaxed) + 1;
        refresher.stale.insert(chat_id.to_owned(), ticket);
        let store = self.history_tails.clone();
        let chat_id = chat_id.to_owned();
        tokio::spawn(async move {
            tokio::time::sleep(REFRESH_DELAY).await;
            if refresher.stale.get(&chat_id).map(|t| *t) == Some(ticket) {
                refresher.run(&chat_id, store.as_deref()).await;
            }
        });
    }

    /// Finishes every refresh still pending, within `budget`. Called once at
    /// shutdown, before the chat manager is disposed.
    pub async fn flush_history_refreshes(&self, budget: Duration) {
        let refresher = &self.history_refresh;
        let pending: Vec<String> = refresher.stale.iter().map(|e| e.key().clone()).collect();
        if pending.is_empty() {
            return;
        }
        let store = self.history_tails.as_deref();
        let flushed = tokio::time::timeout(budget, async {
            for chat_id in &pending {
                refresher.run(chat_id, store).await;
            }
        })
        .await;
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
        let Some(ticket) = self.stale.get(chat_id).map(|t| *t) else {
            return;
        };
        if let Some(manager) = self.manager.get().and_then(Weak::upgrade)
            && let Some(refreshed) = manager.refresh_history_cache(chat_id).await
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

/// Builds the first window a cold resume would send for `refreshed`, through
/// the same encoder a live resume uses, and stores it as the chat's tail.
async fn write_tail(
    manager: &ChatManager,
    store: &TailStore,
    chat_id: &str,
    window: TailWindow,
    refreshed: RefreshedHistory,
) {
    let RefreshedHistory {
        messages,
        validation,
    } = refreshed;
    let options = ResumeOptions {
        result_previews: window.previews,
        windowed_history: true,
    };
    let request = first_window_request(chat_id, &window.window);
    let port = StoredHistory(messages);
    let (response, replay): (JsonRpcResponse, _) =
        mainframe_acp::dispatch_resume_with(request, &port, None, options).await;
    let prepared =
        tokio::task::spawn_blocking(move || PreparedHistoryTail::capture(&response, &replay)).await;
    let Ok(Some(tail)) = prepared else {
        return;
    };
    if !manager.validate_history(chat_id, &validation).await {
        return;
    }
    let manifest = Manifest {
        version: store::FORMAT_VERSION,
        generation: nanoid::nanoid!(),
        chat_id: chat_id.to_owned(),
        window: window.window,
        previews: window.previews,
        validation,
    };
    if let Some(permit) = store.writer_wait().await {
        store.write(manifest, tail, permit).await;
    }
}

fn first_window_request(chat_id: &str, window: &Value) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: None,
        method: "session/resume".into(),
        params: Some(json!({
            "sessionId": chat_id,
            "cwd": "",
            "replayFrom": { "type": "start" },
            "_meta": { MAINFRAME_META_NAMESPACE: { "window": window } },
        })),
    }
}

/// A resume port over an already-built display history of an idle chat.
struct StoredHistory(Vec<DisplayMessage>);

impl ResumePort for StoredHistory {
    fn resume_snapshot<'a>(&'a self, _session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
        Box::pin(async move {
            ResumeSnapshot {
                messages: self.0.clone(),
                streaming: None,
                pending: None,
            }
        })
    }

    fn read_snapshot<'a>(
        &'a self,
        _session_id: &'a str,
        read: SnapshotReader<'a>,
    ) -> BoxFuture<'a, (JsonRpcResponse, mainframe_acp::ResumeReplay)> {
        Box::pin(async move { read(&self.0, None, None) })
    }

    fn is_running(&self, _session_id: &str) -> bool {
        false
    }
}
