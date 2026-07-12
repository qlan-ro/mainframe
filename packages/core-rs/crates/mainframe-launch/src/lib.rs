//! Ported from `src/launch/*` and `src/tunnel/*` (packages/core).
//!
//! `mainframe-launch` owns the launcher (parse/validate `launch.json`, spawn +
//! stream + tear down user launch processes, one manager per project) and the
//! cloudflared tunnel manager. DaemonEvents are emitted through a broadcast
//! handle (`BroadcastFn`) passed in by the daemon, matching the CONTRACT
//! ws-events shapes (`launch.*`, `tunnel:status`).
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod expand_variables;
pub mod launch_config;
pub mod launch_manager;
pub mod launch_process_state;
pub mod launch_registry;
pub mod process;
pub mod resolve_cloudflared;
pub mod tunnel_manager;

pub use expand_variables::expand_variables;
pub use launch_config::parse_launch_config;
pub use launch_manager::{LaunchError, LaunchManager, LaunchTimings, clean_env};
pub use launch_process_state::{LaunchOutputEntry, LaunchProcessState};
pub use launch_registry::LaunchRegistry;
pub use process::{
    ChildRegistryPort, FileChildRegistry, ManagedChildEntry, ManagedChildKind, NoopChildRegistry,
    SweepDeps, SweepResult, default_sweep_deps, sweep_stray_children,
};
pub use resolve_cloudflared::{ResolveCloudflaredDeps, resolve_cloudflared_path};
pub use tunnel_manager::{
    BroadcastFn, TunnelConfig, TunnelManager, TunnelManagerOptions, TunnelStartOptions,
};
