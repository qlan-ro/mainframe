//! Ownership, single-flight and listing for the per-port quick tunnels behind
//! `/api/tunnel/ports/*` (#279).
//!
//! `TunnelManager` keeps no scope metadata, offers no listing, and its `start`
//! kills-and-respawns its label — so the dedupe, the in-flight registry and the
//! ownership map live here.
//!
//! **Invariant: this registry never spawns a process.** Every spawn goes through
//! `TunnelManager::start`, which owns the lifelong stdout/stderr drain; a
//! cloudflared child without that drain SIGPIPE-dies moments after it is ready.
//!
//! The registry mirrors state it does not own: `TunnelManager`'s exit watcher
//! removes a label and broadcasts `stopped` when cloudflared dies, behind this
//! map's back. Every read of a ready entry is therefore liveness-checked
//! against the manager.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tokio::sync::watch;

use crate::tunnel_manager::TunnelManager;

#[cfg(test)]
mod tests;

/// Kept in sync with `PORT_TUNNEL_LABEL_PREFIX` in
/// `packages/types/src/smart-actions/port-tunnels.ts`, which the UI uses to
/// filter `tunnel:status` events.
pub const PORT_TUNNEL_LABEL_PREFIX: &str = "port:";

pub fn port_tunnel_label(port: u16) -> String {
    format!("{PORT_TUNNEL_LABEL_PREFIX}{port}")
}

/// The chat scope a tunnel was started for. The effective path is deliberately
/// *not* captured: `disable_worktree` moves a chat's path afterwards, so
/// teardown resolves the path from `chat_id` instead.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PortTunnelScope {
    pub project_id: String,
    pub chat_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PortTunnelEntryInfo {
    pub port: u16,
    pub url: Option<String>,
    pub ready: bool,
}

type StartOutcome = Result<String, String>;
type Waiters = watch::Sender<Option<StartOutcome>>;

enum Entry {
    Starting {
        scope: PortTunnelScope,
        waiters: Waiters,
        cancel_requested: bool,
    },
    Ready {
        scope: PortTunnelScope,
        url: String,
    },
}

impl Entry {
    fn scope(&self) -> &PortTunnelScope {
        match self {
            Entry::Starting { scope, .. } | Entry::Ready { scope, .. } => scope,
        }
    }
}

enum StartAction {
    Existing(String),
    Wait(watch::Receiver<Option<StartOutcome>>),
    Spawn(Waiters),
}

const CANCELLED: &str = "Tunnel start cancelled";

pub struct PortTunnelRegistry {
    manager: Arc<TunnelManager>,
    inner: Mutex<HashMap<u16, Entry>>,
}

impl PortTunnelRegistry {
    pub fn new(manager: Arc<TunnelManager>) -> Self {
        Self {
            manager,
            inner: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<u16, Entry>> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Starts a tunnel for `port`, or joins the one already running or starting.
    /// Exactly one `TunnelManager::start` is in flight per port at a time.
    pub async fn start(&self, port: u16, scope: PortTunnelScope) -> StartOutcome {
        let label = port_tunnel_label(port);
        match self.plan_start(port, &label, scope) {
            StartAction::Existing(url) => Ok(url),
            StartAction::Wait(mut waiters) => await_outcome(&mut waiters).await,
            StartAction::Spawn(waiters) => {
                let outcome =
                    self.settle(port, &label, self.manager.start(port, &label, None).await);
                let _ = waiters.send(Some(outcome.clone()));
                outcome
            }
        }
    }

    fn plan_start(&self, port: u16, label: &str, scope: PortTunnelScope) -> StartAction {
        let mut inner = self.lock();
        match inner.get_mut(&port) {
            Some(Entry::Starting { waiters, .. }) => return StartAction::Wait(waiters.subscribe()),
            Some(Entry::Ready { scope: owner, url }) if self.manager.get_url(label).is_some() => {
                // Last-start-wins: a later chat takes ownership of the tunnel it
                // just asked for, without minting a new URL.
                *owner = scope;
                return StartAction::Existing(url.clone());
            }
            _ => {}
        }
        let (waiters, _) = watch::channel(None);
        inner.insert(
            port,
            Entry::Starting {
                scope,
                waiters: waiters.clone(),
                cancel_requested: false,
            },
        );
        StartAction::Spawn(waiters)
    }

    fn settle(&self, port: u16, label: &str, result: StartOutcome) -> StartOutcome {
        let mut inner = self.lock();
        let url = match result {
            Ok(url) => url,
            Err(err) => {
                inner.remove(&port);
                return Err(err);
            }
        };
        let Some(Entry::Starting {
            scope,
            cancel_requested,
            ..
        }) = inner.remove(&port)
        else {
            return Ok(url);
        };
        if cancel_requested {
            drop(inner);
            self.manager.stop(label);
            return Err(CANCELLED.to_string());
        }
        inner.insert(
            port,
            Entry::Ready {
                scope,
                url: url.clone(),
            },
        );
        Ok(url)
    }

    /// Idempotent. Stopping a tunnel that is still starting is recorded as a
    /// cancellation and applied the moment the start resolves — a mid-start
    /// cloudflared is invisible to `TunnelManager::stop`.
    pub fn stop(&self, port: u16) {
        let removed = {
            let mut inner = self.lock();
            if let Some(Entry::Starting {
                cancel_requested, ..
            }) = inner.get_mut(&port)
            {
                *cancel_requested = true;
                None
            } else {
                inner.remove(&port)
            }
        };
        if removed.is_some() {
            self.manager.stop(&port_tunnel_label(port));
        }
    }

    /// Every tunnel owned by `project_id`, with the chat that started it. The
    /// caller resolves those chats to paths — this crate has no db.
    pub fn entries_for_project(&self, project_id: &str) -> Vec<(u16, String)> {
        let mut entries: Vec<(u16, String)> = self
            .lock()
            .iter()
            .filter(|(_, entry)| entry.scope().project_id == project_id)
            .map(|(port, entry)| (*port, entry.scope().chat_id.clone()))
            .collect();
        entries.sort_unstable();
        entries
    }

    /// Every live tunnel, ordered by port. Ready entries the manager has already
    /// reaped are pruned rather than reported.
    pub fn list(&self) -> Vec<PortTunnelEntryInfo> {
        let mut inner = self.lock();
        let mut live = Vec::new();
        let mut reaped = Vec::new();
        for (port, entry) in inner.iter() {
            match entry {
                Entry::Starting { .. } => live.push(PortTunnelEntryInfo {
                    port: *port,
                    url: None,
                    ready: false,
                }),
                Entry::Ready { url, .. } => {
                    if self.manager.get_url(&port_tunnel_label(*port)).is_some() {
                        live.push(PortTunnelEntryInfo {
                            port: *port,
                            url: Some(url.clone()),
                            ready: true,
                        });
                    } else {
                        reaped.push(*port);
                    }
                }
            }
        }
        for port in reaped {
            inner.remove(&port);
        }
        live.sort_unstable_by_key(|entry| entry.port);
        live
    }
}

async fn await_outcome(waiters: &mut watch::Receiver<Option<StartOutcome>>) -> StartOutcome {
    loop {
        if let Some(outcome) = waiters.borrow_and_update().clone() {
            return outcome;
        }
        if waiters.changed().await.is_err() {
            return Err("Tunnel start abandoned".to_string());
        }
    }
}
