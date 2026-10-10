//! Ported from `src/process/index.ts` — re-exports the child registry + sweep.

pub mod child_registry;
pub mod sweep;

pub use child_registry::{
    BoxFuture, ChildRegistryPort, FileChildRegistry, ManagedChildEntry, ManagedChildKind,
    NoopChildRegistry, now_ms,
};
pub use sweep::{
    KillFn, ProcessQueryFn, SweepDeps, SweepPlatform, SweepResult, default_kill,
    default_process_command, default_process_cwd, default_sweep_deps, process_matches_binary,
    process_matches_launch, sweep_stray_children,
};
