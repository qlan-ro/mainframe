//! `mainframe-launch` owns the launcher (parse/validate `launch.json`, spawn +
//! stream + tear down user launch processes, one manager per project) and the
//! cloudflared tunnel manager. Both emit `DaemonEvent`s (`launch.*`,
//! `tunnel:status`) through the `BroadcastFn` the daemon passes in.
#![forbid(unsafe_code)]
#![cfg_attr(
    test,
    allow(
        clippy::too_many_lines,
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "Test assertions and scenarios"
    )
)]

mod expand_variables;
mod launch_config;
mod launch_manager;
mod launch_process_state;
mod launch_registry;
mod port_tunnel_registry;
mod process;
mod resolve_cloudflared;
#[cfg(test)]
mod test_support;
mod tunnel_error;
mod tunnel_manager;

pub use expand_variables::UnresolvedVariable;
pub use launch_config::{LaunchConfigError, parse_launch_config};
pub use launch_manager::{LaunchError, LaunchManager};
pub use launch_process_state::LaunchOutputEntry;
pub use launch_registry::{LaunchRegistry, shutdown_launches_and_tunnels};
pub use port_tunnel_registry::{
    PORT_TUNNEL_LABEL_PREFIX, PortTunnelEntryInfo, PortTunnelRegistry, PortTunnelScope,
    port_tunnel_label,
};
pub use process::{
    ChildRegistryPort, FileChildRegistry, KillFn, ManagedChildEntry, ManagedChildKind,
    ProcessQueryFn, SweepDeps, SweepPlatform, SweepResult, default_sweep_deps,
    sweep_stray_children,
};
pub use resolve_cloudflared::{IsExecutableFn, ResolveCloudflaredDeps, resolve_cloudflared_path};
pub use tunnel_error::TunnelStartError;
pub use tunnel_manager::{
    BroadcastFn, TunnelConfig, TunnelManager, TunnelManagerOptions, TunnelStartOptions,
};
