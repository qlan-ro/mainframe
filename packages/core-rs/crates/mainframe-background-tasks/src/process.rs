use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

use mainframe_runtime::ResolvedPath;

/// The OS probes and signals a tracker uses, each swappable in tests.
pub(crate) struct ProcessDeps {
    pub(crate) lsof: Mutex<crate::lsof::LsofFn>,
    /// Set after the first "lsof not installed" warning, so liveness ticks
    /// don't repeat it every minute.
    pub(crate) lsof_missing_warned: AtomicBool,
    pub(crate) kill: Mutex<crate::kill::KillSeam>,
}

impl ProcessDeps {
    pub(crate) fn new(path: ResolvedPath) -> Self {
        Self {
            lsof: Mutex::new(crate::lsof::real_lsof(path.clone())),
            lsof_missing_warned: AtomicBool::new(false),
            kill: crate::kill::new_seam(path),
        }
    }
}

impl Default for ProcessDeps {
    fn default() -> Self {
        Self::new(ResolvedPath::from_value(
            std::env::var("PATH").unwrap_or_default(),
        ))
    }
}

impl std::fmt::Debug for ProcessDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProcessDeps").finish_non_exhaustive()
    }
}
