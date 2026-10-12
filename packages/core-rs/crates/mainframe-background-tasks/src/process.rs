use mainframe_runtime::ResolvedPath;
use std::sync::Mutex;

pub struct ProcessDeps {
    pub(crate) lsof: Mutex<crate::lsof::Seam>,
    pub(crate) kill: Mutex<crate::kill::KillSeam>,
}

impl ProcessDeps {
    pub fn new(path: ResolvedPath) -> Self {
        Self {
            lsof: crate::lsof::new_seam(path.clone()),
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
