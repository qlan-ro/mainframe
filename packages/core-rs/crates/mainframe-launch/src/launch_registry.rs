//! Ported from `src/launch/launch-registry.ts`.
//!
//! One `LaunchManager` per `projectId:projectPath`, created on demand and shared.
//! CONCURRENCY.tsv: `managers` = `Arc<DashMap<String, Arc<LaunchManager>>>`.

use std::sync::Arc;

use dashmap::DashMap;

use crate::launch_manager::LaunchManager;
use crate::tunnel_manager::{BroadcastFn, TunnelManager};

pub struct LaunchRegistry {
    managers: DashMap<String, Arc<LaunchManager>>,
    on_event: BroadcastFn,
    pub tunnel_manager: Option<Arc<TunnelManager>>,
    /// Boot-resolved login-shell `PATH` (see `mainframe_runtime::ResolvedPath`),
    /// forwarded to each `LaunchManager` so launch children resolve the user's
    /// toolchain (mirrors the TS `enrichPath` env mutation; `MAINFRAME_ORIG_PATH`
    /// still overrides it in `clean_env`). `None` = inherit the daemon `PATH`.
    resolved_path: Option<String>,
}

impl LaunchRegistry {
    pub fn new(on_event: BroadcastFn, tunnel_manager: Option<Arc<TunnelManager>>) -> Self {
        Self {
            managers: DashMap::new(),
            on_event,
            tunnel_manager,
            resolved_path: None,
        }
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
                Arc::new(LaunchManager::new(
                    project_id.to_string(),
                    project_path.to_string(),
                    self.on_event.clone(),
                    self.tunnel_manager.clone(),
                    self.resolved_path.clone(),
                ))
            })
            .clone()
    }

    pub async fn stop_all(&self) {
        let managers: Vec<Arc<LaunchManager>> =
            self.managers.iter().map(|e| e.value().clone()).collect();
        // Promise.allSettled — every manager's stop runs regardless of the others.
        futures_join_all(managers.iter().map(|m| m.stop_all())).await;
        self.managers.clear();
    }
}

/// Minimal `join_all` (no `futures` crate in the allowlist): await each in turn.
/// The TS uses `Promise.allSettled`; a `LaunchManager::stop_all` cannot fail
/// (returns `()`), so sequential awaiting is behaviorally equivalent.
async fn futures_join_all<F: std::future::Future<Output = ()>>(futures: impl Iterator<Item = F>) {
    for future in futures {
        future.await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::events::DaemonEvent;
    use std::sync::Mutex;

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
}

// PORT STATUS: src/launch/launch-registry.ts (32 lines)
// confidence: high
// todos: 0
// notes: managers = Arc<DashMap<"projectId:projectPath", Arc<LaunchManager>>>.
// get/get_or_create mirror the TS; the shared on_event + tunnelManager are cloned
// into each new manager. stopAll → await every manager.stop_all then clear (a
// local join_all stands in for Promise.allSettled — stop_all is infallible, so
// sequential await is equivalent; no `futures` crate in the allowlist).
