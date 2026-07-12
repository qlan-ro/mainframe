//! Project-registry port (T9.2): run_action's `ActionCtx.project_root`
//! containment base. Mirrors Node service.resolveProjectRoot — the
//! automation's own project when set, else the workspace's first project,
//! else the daemon cwd. Production impl lives in mainframe-server over the
//! projects repository.

use crate::engine::BoxFuture;

pub trait ProjectRegistry: Send + Sync {
    /// Resolve the containment root for a run's actions. Never fails: the
    /// fallback chain ends at the daemon cwd (Node parity).
    fn resolve_project_root<'a>(&'a self, project_id: Option<&'a str>) -> BoxFuture<'a, String>;
}

// PORT STATUS: packages/core/src/automations/service.ts resolveProjectRoot (7 lines)
// confidence: high
// todos: 0
// notes: worktree-aware run-in stays unwired on BOTH engines (Node never
//        populates ActionCtx.worktreePath); run_command's `worktree` mode
//        fails with its clear in-action error until a later pass wires it.
