//! The persistent child registry and the boot-time stray-child sweep.

pub mod child_registry;
pub mod sweep;

pub use child_registry::{
    BoxFuture, ChildRegistryPort, FileChildRegistry, ManagedChildEntry, ManagedChildKind,
    NoopChildRegistry, now_ms,
};
pub(crate) use sweep::default_process_command;
pub use sweep::{
    KillFn, ProcessQueryFn, SweepDeps, SweepPlatform, SweepResult, default_sweep_deps,
    sweep_stray_children,
};
