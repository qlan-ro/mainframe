//! Per-project concurrency guard for skills-CLI operations. Module-level
//! `DashSet`, mirroring `mainframe_git::project_lock`'s module-level
//! per-project lock — but refusal, not queueing: the `skills` CLI writes a
//! project lockfile, so a second concurrent operation for the same project
//! must be rejected outright rather than waiting its turn.

use std::sync::OnceLock;

use dashmap::DashSet;

fn in_flight() -> &'static DashSet<String> {
    static IN_FLIGHT: OnceLock<DashSet<String>> = OnceLock::new();
    IN_FLIGHT.get_or_init(DashSet::new)
}

/// Holds the slot for `project_id` until dropped.
pub struct Guard {
    project_id: String,
}

impl Drop for Guard {
    fn drop(&mut self) {
        in_flight().remove(&self.project_id);
    }
}

/// `None` when another operation for `project_id` is already in flight.
pub fn acquire(project_id: &str) -> Option<Guard> {
    in_flight().insert(project_id.to_string()).then(|| Guard {
        project_id: project_id.to_string(),
    })
}
