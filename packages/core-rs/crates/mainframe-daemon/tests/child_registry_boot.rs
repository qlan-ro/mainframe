//! Cluster B boot wiring: the daemon constructs ONE `FileChildRegistry`
//! (`managed-children.json` under the data dir) and shares it between the
//! `TunnelManager` and the `LaunchRegistry`, then runs `sweep_stray_children`
//! after the port bind to reap children a previous crash leaked. This test
//! reproduces that exact construction — the shared `Arc<dyn ChildRegistryPort>`
//! passed to `TunnelManager::with_options` and `LaunchRegistry::with_child_registry`
//! — seeds a stray record through the shared handle, runs the same sweep call
//! `main.rs` makes (`default_sweep_deps`), and asserts the dead orphan is pruned.
//!
//! Integration tests are only built under `cargo test`, so `unwrap`/`expect` are
//! permitted here (RUST RULES `#[cfg(test)]` exemption).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;

use mainframe_launch::{
    BroadcastFn, ChildRegistryPort, FileChildRegistry, LaunchRegistry, ManagedChildEntry,
    ManagedChildKind, TunnelManager, TunnelManagerOptions, default_sweep_deps,
    sweep_stray_children,
};

/// A pid no live process can hold on macOS/Linux, so `ps` reports it gone and the
/// sweep prunes the record without ever issuing a real `kill`.
const DEAD_PID: i64 = 2_000_000_000;

#[tokio::test]
async fn boot_shares_one_child_registry_and_sweeps_stray_orphans() {
    let data_dir = tempfile::tempdir().unwrap();
    let pidfile = data_dir.path().join("managed-children.json");

    // Boot construction (index.ts): one registry, shared by both managers.
    let child_registry: Arc<dyn ChildRegistryPort> = Arc::new(FileChildRegistry::new(
        pidfile.to_string_lossy().into_owned(),
    ));

    let noop_event: BroadcastFn = Arc::new(|_| {});
    let tunnel_manager = Arc::new(TunnelManager::with_options(
        Some(Arc::clone(&noop_event)),
        TunnelManagerOptions {
            registry: Some(Arc::clone(&child_registry)),
            cloudflared_path: Some("/usr/local/bin/cloudflared".to_string()),
        },
    ));
    let _launch_registry = Arc::new(
        LaunchRegistry::new(Arc::clone(&noop_event), Some(Arc::clone(&tunnel_manager)))
            .with_child_registry(Arc::clone(&child_registry)),
    );

    // Seed a record a crashed daemon would have leaked (its process is long dead).
    child_registry
        .add(ManagedChildEntry {
            pid: DEAD_PID,
            kind: ManagedChildKind::Tunnel,
            command: "/usr/local/bin/cloudflared".to_string(),
            args: vec!["tunnel".to_string(), "run".to_string()],
            cwd: None,
            group: false,
            label: "daemon".to_string(),
            spawned_at: 0,
        })
        .await;
    assert!(
        pidfile.exists(),
        "the shared pidfile must be written under the data dir"
    );
    assert_eq!(child_registry.list().await.len(), 1);

    // The exact post-bind sweep call from main.rs.
    let result = sweep_stray_children(child_registry.as_ref(), &default_sweep_deps()).await;

    assert_eq!(result.total, 1, "the seeded orphan is the only record");
    assert!(
        child_registry.list().await.is_empty(),
        "the dead orphan's record must be pruned by the sweep"
    );
}
