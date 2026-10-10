//! Seam traits for the launch subsystem the `ChatManager` depends on: launch
//! process teardown ([`LaunchStopper`]) and port-tunnel teardown
//! ([`ScopeTunnelStopper`]). The `ChatManagerDeps` methods that reach these
//! subsystems delegate to the seam, so the daemon boot wires the
//! `mainframe-launch` registry-backed impls and test harnesses wire the no-op
//! ones with no change to `DaemonChatDeps`.
//!
//! Notifications, per-chat todos and push are not seams: `DaemonChatDeps` wires
//! them to the real implementations (`mainframe_services::notifications`,
//! `db.chats.update_todos`, and `mainframe_services::push::PushService`). See
//! `chat_deps.rs`.

use std::sync::Arc;

use mainframe_adapter_api::BoxFuture;
use mainframe_launch::{LaunchRegistry, PortTunnelRegistry};

use crate::db::Db;
use crate::routes::files::effective_path_sync;

/// The launch-process control surface the `ChatManager` needs before it tears
/// down a worktree: look up the scope's launch manager and, if there is one,
/// stop all of its processes.
pub trait LaunchStopper: Send + Sync {
    /// Stop every launch process bound to `(project_id, effective_path)`. Returns
    /// `None` when there is no launch manager for that scope (no configs →
    /// nothing to stop).
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>>;
}

/// The no-op stopper for harnesses that run without a launch registry: there
/// is never a manager to stop.
pub struct NoopLaunchStopper;

impl LaunchStopper for NoopLaunchStopper {
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        tracing::debug!(
            project_id,
            effective_path,
            "stopLaunchProcesses seam: launch registry not ported (Phase 5) — no-op"
        );
        None
    }
}

/// The production `LaunchStopper`, backed by the `LaunchRegistry`.
pub struct RegistryLaunchStopper {
    registry: Arc<LaunchRegistry>,
}

impl RegistryLaunchStopper {
    pub fn new(registry: Arc<LaunchRegistry>) -> Self {
        Self { registry }
    }
}

impl LaunchStopper for RegistryLaunchStopper {
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        // No manager for this scope → nothing to stop.
        let manager = self.registry.get(project_id, effective_path)?;
        Some(Box::pin(async move {
            manager.stop_all().await;
        }))
    }
}

/// The port-tunnel teardown surface, a sibling of [`LaunchStopper`] rather
/// than a branch inside it: a scope that never ran a launch config has no
/// `LaunchRegistry` entry, and those are exactly the scopes that tunnel a dev
/// server started by hand.
pub trait ScopeTunnelStopper: Send + Sync {
    /// Stop every port tunnel owned by the released scope. `None` when there is
    /// nothing to stop.
    fn stop_scope_tunnels<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>>;
}

/// No registry (route-unit harness / a daemon booted without tunnels).
pub struct NoopScopeTunnelStopper;

impl ScopeTunnelStopper for NoopScopeTunnelStopper {
    fn stop_scope_tunnels<'a>(
        &'a self,
        _project_id: &'a str,
        _effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        None
    }
}

/// The production impl. The registry keys tunnels by the chat that started them,
/// so each candidate's path is resolved *now* rather than compared against one
/// captured at start — `disable_worktree` moves a chat's path afterwards, and a
/// captured key would never match again, leaking a public URL past teardown.
pub struct RegistryScopeTunnelStopper {
    registry: Arc<PortTunnelRegistry>,
    db: Db,
}

impl RegistryScopeTunnelStopper {
    pub fn new(registry: Arc<PortTunnelRegistry>, db: Db) -> Self {
        Self { registry, db }
    }

    /// `None` also means "stop": the owning chat is gone or its worktree
    /// vanished, so no live scope can claim the tunnel.
    async fn belongs_to_scope(
        &self,
        project_id: &str,
        chat_id: &str,
        effective_path: &str,
    ) -> bool {
        let pid = project_id.to_string();
        let cid = chat_id.to_string();
        let resolved = self
            .db
            .call(move |db| effective_path_sync(db, &pid, Some(&cid)))
            .await;
        match resolved {
            Ok(Some(path)) => path == effective_path,
            Ok(None) => true,
            Err(err) => {
                tracing::warn!(%err, project_id, chat_id, "port-tunnel scope resolution failed");
                false
            }
        }
    }
}

impl ScopeTunnelStopper for RegistryScopeTunnelStopper {
    fn stop_scope_tunnels<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        let entries = self.registry.entries_for_project(project_id);
        if entries.is_empty() {
            return None;
        }
        Some(Box::pin(async move {
            for (port, chat_id) in entries {
                if self
                    .belongs_to_scope(project_id, &chat_id, effective_path)
                    .await
                {
                    self.registry.stop(port).await;
                }
            }
        }))
    }
}
