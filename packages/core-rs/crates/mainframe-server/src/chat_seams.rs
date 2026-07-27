//! Phase-5 seam traits for the subsystems the `ChatManager` depends on that are
//! not yet ported (the `mainframe-launch` crate). The `ChatManagerDeps` methods
//! that reach these subsystems delegate to the seam so, when Phase 5 lands, the
//! real `LaunchRegistry` slots in behind the same trait with no change to the
//! wired `DaemonChatDeps`.
//!
//! Only launch is stubbed here. The other subsystems the task flagged as
//! Phase-5-shaped (notifications, per-chat todos, push) turned out to be already
//! ported — `mainframe_services::notifications`, `db.chats.update_todos`, and
//! `mainframe_services::push::PushService` — so `DaemonChatDeps` wires them to the
//! real implementations rather than stubbing them (stubbing ported behaviour would
//! *reduce* fidelity). See `chat_deps.rs`.

use std::sync::Arc;

use mainframe_adapter_api::BoxFuture;
use mainframe_launch::{LaunchRegistry, PortTunnelRegistry};

use crate::db::Db;
use crate::routes::files::effective_path_sync;

/// The launch-process control surface the `ChatManager` needs before it tears
/// down a worktree (`chats.setStopLaunchProcesses` in `index.ts`). Mirrors the
/// single call the TS makes: `const m = launchRegistry.get(projectId, path);
/// if (m) await m.stopAll();`.
///
/// TODO(port-phase5): replace `NoopLaunchStopper` with an impl backed by the
/// ported `mainframe-launch::LaunchRegistry`.
pub trait LaunchStopper: Send + Sync {
    /// Stop every launch process bound to `(project_id, effective_path)`. Returns
    /// `None` when there is no launch manager for that scope — faithful to the TS
    /// `if (m)` guard (no configs → nothing to stop).
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>>;
}

/// The Phase-4 default: no launch registry exists yet, so there is never a
/// manager to stop. Matches `chats.setStopLaunchProcesses` never having been
/// wired (the TS `stopLaunchProcesses` stays `undefined`).
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

/// Convenience constructor for the boot path.
pub fn default_launch_stopper() -> Arc<dyn LaunchStopper> {
    Arc::new(NoopLaunchStopper)
}

/// The production `LaunchStopper`, backed by the real `LaunchRegistry` (Task 5.5).
/// Mirrors `chats.setStopLaunchProcesses(async (projectId, projectPath) => {
/// const m = launchRegistry.get(projectId, projectPath); if (m) await m.stopAll();
/// })` in `index.ts`.
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
        // `if (m)` guard: no manager for this scope → nothing to stop.
        let manager = self.registry.get(project_id, effective_path)?;
        Some(Box::pin(async move {
            manager.stop_all().await;
        }))
    }
}

/// The port-tunnel teardown surface (#279), a sibling of [`LaunchStopper`] rather
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

pub fn default_scope_tunnel_stopper() -> Arc<dyn ScopeTunnelStopper> {
    Arc::new(NoopScopeTunnelStopper)
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
                    self.registry.stop(port);
                }
            }
        }))
    }
}

// PORT STATUS: (launch seam for chat/index.ts setStopLaunchProcesses)
// confidence: high
// todos: 0
// notes: Task 5.5 wired the real RegistryLaunchStopper over mainframe-launch's
// LaunchRegistry (get(projectId, path) → if Some, stop_all()), matching the TS
// `setStopLaunchProcesses` closure exactly. NoopLaunchStopper stays as the
// route-unit/test fallback (→ None, the `if (m)` guard with no manager).
// notifications / per-chat todos / push are ported + wired in chat_deps.rs.
