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

// PORT STATUS: src/process/index.ts (re-exports)
// confidence: high
// todos: 0
// notes: crate-map addition (process/ had no PORTING row). Re-exports mirror the
// TS index.ts: FileChildRegistry/NoopChildRegistry + the ChildRegistryPort trait
// and entry types; sweepStrayChildren + the process-match predicates + default deps.
