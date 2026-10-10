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
    resolved_path: Option<String>,
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
        self.resolved_path = Some(path.into());
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
                tracing::warn!(?err, "launch shutdown task failed");
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
mod tests {
    use super::*;
    use crate::test_support::{recorder, recording_signal, write_ready_term_ignoring_cloudflared};
    use crate::tunnel_manager::TunnelConfig;
    use mainframe_types::events::DaemonEvent;
    use mainframe_types::launch::LaunchConfiguration;
    use std::sync::Mutex;
    use std::time::Duration;

    fn noop() -> BroadcastFn {
        Arc::new(|_ev: DaemonEvent| {})
    }

    #[tokio::test]
    async fn get_or_create_returns_the_same_manager_per_key() {
        let registry = LaunchRegistry::new(noop(), None);
        let a = registry.get_or_create("p1", "/wt/x");
        let b = registry.get_or_create("p1", "/wt/x");
        assert!(Arc::ptr_eq(&a, &b));
    }

    #[tokio::test]
    async fn distinct_keys_get_distinct_managers() {
        let registry = LaunchRegistry::new(noop(), None);
        let a = registry.get_or_create("p1", "/wt/x");
        let b = registry.get_or_create("p1", "/wt/y");
        assert!(!Arc::ptr_eq(&a, &b));
    }

    #[tokio::test]
    async fn get_returns_none_until_created() {
        let registry = LaunchRegistry::new(noop(), None);
        assert!(registry.get("p1", "/wt/x").is_none());
        registry.get_or_create("p1", "/wt/x");
        assert!(registry.get("p1", "/wt/x").is_some());
    }

    #[tokio::test]
    async fn stop_all_clears_the_registry() {
        let registry = LaunchRegistry::new(noop(), None);
        registry.get_or_create("p1", "/wt/x");
        registry.stop_all().await;
        assert!(registry.get("p1", "/wt/x").is_none());
    }

    #[tokio::test]
    async fn broadcast_is_shared_across_managers() {
        let events = Arc::new(Mutex::new(Vec::<DaemonEvent>::new()));
        let sink = events.clone();
        let broadcast: BroadcastFn = Arc::new(move |ev| sink.lock().unwrap().push(ev));
        let registry = LaunchRegistry::new(broadcast, None);
        let manager = registry.get_or_create("p1", "/tmp");
        manager
            .start(&mainframe_types::launch::LaunchConfiguration {
                name: "quick".to_string(),
                runtime_executable: "sh".to_string(),
                runtime_args: vec!["-c".to_string(), "exit 0".to_string()],
                port: None,
                url: None,
                preview: Some(false),
                env: None,
            })
            .await
            .unwrap();
        assert!(
            events
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, DaemonEvent::LaunchStatus { .. }))
        );
        registry.stop_all().await;
    }

    #[tokio::test]
    async fn shutdown_kills_a_launch_preview_tunnel_that_ignores_sigterm() {
        let dir = tempfile::tempdir().unwrap();
        let mut tunnels = TunnelManager::with_config(
            None,
            TunnelConfig {
                cloudflared_bin: write_ready_term_ignoring_cloudflared(dir.path()),
                dns_poll: Duration::from_millis(20),
                dns_timeout: Duration::from_millis(60),
                stop_grace: Duration::from_millis(500),
                ..TunnelConfig::default()
            },
        );
        let (signal, signals) = recording_signal();
        tunnels.set_signal(signal);
        let tunnels = Arc::new(tunnels);
        let (broadcast, events) = recorder();
        let registry = LaunchRegistry::new(broadcast, Some(tunnels.clone()));
        // Accepts connections through its backlog, so the launch's port wait passes.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        registry
            .get_or_create("p1", "/tmp")
            .start(&LaunchConfiguration {
                name: "web".to_string(),
                runtime_executable: "sh".to_string(),
                runtime_args: vec!["-c".to_string(), "sleep 100".to_string()],
                port: Some(i64::from(port)),
                url: None,
                preview: Some(true),
                env: None,
            })
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let ready = events
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|e| matches!(e, DaemonEvent::LaunchTunnel { .. }));
                if ready {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the preview tunnel should come up");
        let pid = tunnels.pid_of("preview:web").unwrap();

        shutdown_launches_and_tunnels(&registry, &tunnels).await;

        assert_eq!(
            *signals.lock().unwrap(),
            vec![(pid, "-TERM"), (pid, "-KILL")]
        );
        assert_eq!(tunnels.live_count(), 0);
        assert_eq!(tunnels.get_url("preview:web"), None);
    }
}
#[cfg(test)]
#[path = "launch_registry_shutdown_tests.rs"]
mod shutdown_tests;
