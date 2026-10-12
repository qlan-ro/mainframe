//! One `LaunchManager` per `projectId:projectPath`, created on demand and shared.
//! State: `managers` = `Arc<DashMap<String, Arc<LaunchManager>>>`.

use std::sync::Arc;

use dashmap::DashMap;

use crate::launch_manager::LaunchManager;
use crate::process::ChildRegistryPort;
use crate::tunnel_manager::{BroadcastFn, TunnelManager};

pub struct LaunchRegistry {
    managers: DashMap<String, Arc<LaunchManager>>,
    spawn_gate: Arc<tokio::sync::Mutex<bool>>,
    on_event: BroadcastFn,
    pub tunnel_manager: Option<Arc<TunnelManager>>,
    /// Pidfile registry passed down to each `LaunchManager` so a crashed daemon's
    /// next startup sweep can reap leaked launch groups. `None` = not tracked.
    child_registry: Option<Arc<dyn ChildRegistryPort>>,
    /// Boot-resolved login-shell `PATH` (see `mainframe_runtime::ResolvedPath`),
    /// forwarded to each `LaunchManager` so launch children resolve the user's
    /// toolchain (`MAINFRAME_ORIG_PATH` still overrides it in `clean_env`).
    /// `None` inherits the daemon `PATH`.
    resolved_path: Option<mainframe_runtime::ResolvedPath>,
}

impl LaunchRegistry {
    pub fn new(on_event: BroadcastFn, tunnel_manager: Option<Arc<TunnelManager>>) -> Self {
        Self {
            managers: DashMap::new(),
            spawn_gate: Arc::new(tokio::sync::Mutex::new(false)),
            on_event,
            tunnel_manager,
            child_registry: None,
            resolved_path: None,
        }
    }

    /// Inject the shared pidfile registry (a builder, to keep the boot call site
    /// additive) passed down to each manager.
    #[must_use]
    pub fn with_child_registry(mut self, child_registry: Arc<dyn ChildRegistryPort>) -> Self {
        self.child_registry = Some(child_registry);
        self
    }

    /// Inject the boot-resolved login-shell `PATH` forwarded to launch children.
    #[must_use]
    pub fn with_resolved_path(mut self, path: impl Into<String>) -> Self {
        self.resolved_path = Some(mainframe_runtime::ResolvedPath::from_value(path.into()));
        self
    }

    fn key(project_id: &str, project_path: &str) -> String {
        format!("{project_id}:{project_path}")
    }

    pub fn get(&self, project_id: &str, project_path: &str) -> Option<Arc<LaunchManager>> {
        self.managers
            .get(&Self::key(project_id, project_path))
            .map(|m| m.clone())
    }

    pub fn get_or_create(&self, project_id: &str, project_path: &str) -> Arc<LaunchManager> {
        let key = Self::key(project_id, project_path);
        self.managers
            .entry(key)
            .or_insert_with(|| {
                Arc::new(
                    LaunchManager::new(
                        project_id.to_string(),
                        project_path.to_string(),
                        self.on_event.clone(),
                        self.tunnel_manager.clone(),
                        self.resolved_path.clone(),
                        self.child_registry.clone(),
                    )
                    .with_spawn_gate(self.spawn_gate.clone()),
                )
            })
            .clone()
    }

    pub async fn close_starts(&self) {
        *self.spawn_gate.lock().await = true;
    }

    pub async fn stop_all(&self) {
        let managers: Vec<Arc<LaunchManager>> =
            self.managers.iter().map(|e| e.value().clone()).collect();
        let mut tasks = tokio::task::JoinSet::new();
        for manager in managers {
            tasks.spawn(async move { manager.stop_all().await });
        }
        while let Some(result) = tasks.join_next().await {
            if let Err(err) = result {
                tracing::warn!(error = ?err, "launch shutdown task failed");
            }
        }
        self.managers.clear();
    }
}

/// Daemon shutdown for launches and tunnels: stop every launch process and
/// every cloudflared child, returning once each tunnel has exited. The tunnel
/// sweep runs alongside the launch stops so a slow launch process cannot hold
/// it up; a preview tunnel is stopped by whichever side reaches it first.
pub async fn shutdown_launches_and_tunnels(launches: &LaunchRegistry, tunnels: &TunnelManager) {
    tokio::join!(launches.close_starts(), tunnels.close_starts());
    tokio::join!(launches.stop_all(), tunnels.stop_all());
}

#[cfg(test)]
#[path = "launch_registry_shutdown_tests.rs"]
mod shutdown_tests;
#[cfg(test)]
#[path = "launch_registry_tests.rs"]
mod tests;
