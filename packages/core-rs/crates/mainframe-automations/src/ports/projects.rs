//! Project-registry port: run_action's `ActionCtx.project_root` containment
//! base — the automation's own project when set, else the workspace's first
//! project, else the daemon cwd. Production impl lives in mainframe-server over
//! the projects repository.

use mainframe_types::BoxFuture;

pub trait ProjectRegistry: Send + Sync {
    /// Resolve the containment root for a run's actions. Never fails: the
    /// fallback chain ends at the daemon cwd.
    fn resolve_project_root<'a>(&'a self, project_id: Option<&'a str>) -> BoxFuture<'a, String>;
}
