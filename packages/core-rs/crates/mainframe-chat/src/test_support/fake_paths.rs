//! The `ProjectPaths` half of [`FakeDeps`]: project path lookups and the
//! daemon-owned directories, all configurable.

use mainframe_types::sync::LockExt as _;
use std::collections::HashSet;
use std::sync::Mutex;

use mainframe_adapter_api::BoxFuture;
use mainframe_types::seam_error::SeamError;

use super::FakeDeps;
use crate::chat_manager::ProjectPaths;

pub(crate) struct FakeProjectPaths {
    /// What `projects_get_path` answers for every project id.
    pub(crate) project_path: Mutex<Option<String>>,
    /// Every project id `projects_remove` was asked to remove, in order.
    pub(crate) project_removed: Mutex<Vec<String>>,
    /// When `Some`, `projects_remove` records the id and then fails with this message.
    pub(crate) fail_project_remove: Mutex<Option<String>>,
    /// When `Some`, `path_exists` answers membership; `None` answers `true`
    /// for every path.
    pub(crate) present_paths: Mutex<Option<HashSet<String>>>,
    /// Every `ensure_dir` path, in order.
    pub(crate) ensure_dir_calls: Mutex<Vec<String>>,
    /// `fork_snapshots_dir()` override (a real tempdir the sweep can list).
    pub(crate) fork_snapshots_dir: Mutex<Option<String>>,
    /// `history_cache_dir()` override (a real tempdir the test alone owns).
    pub(crate) history_cache_dir: Mutex<Option<String>>,
}

impl Default for FakeProjectPaths {
    fn default() -> Self {
        Self {
            project_path: Mutex::new(Some("/tmp/test".to_string())),
            project_removed: Mutex::new(Vec::new()),
            fail_project_remove: Mutex::new(None),
            present_paths: Mutex::new(None),
            ensure_dir_calls: Mutex::new(Vec::new()),
            fork_snapshots_dir: Mutex::new(None),
            history_cache_dir: Mutex::new(None),
        }
    }
}

impl FakeProjectPaths {}

impl FakeProjectPaths {
    pub(crate) fn set_present_paths(&self, paths: &[&str]) {
        let paths = paths.iter().map(|path| (*path).to_string()).collect();
        *self.present_paths.lock_recover() = Some(paths);
    }
}

fn temp_default(name: &str) -> String {
    std::env::temp_dir()
        .join(name)
        .to_string_lossy()
        .into_owned()
}

impl ProjectPaths for FakeDeps {
    fn projects_get_path(&self, _project_id: &str) -> Option<String> {
        self.paths.project_path.lock_recover().clone()
    }
    fn projects_remove(&self, project_id: &str) -> Result<(), SeamError> {
        self.paths
            .project_removed
            .lock_recover()
            .push(project_id.to_string());
        match self.paths.fail_project_remove.lock_recover().clone() {
            Some(msg) => Err(SeamError::msg(msg)),
            None => Ok(()),
        }
    }
    fn path_exists(&self, path: &str) -> bool {
        self.paths
            .present_paths
            .lock_recover()
            .as_ref()
            .is_none_or(|present| present.contains(path))
    }
    fn ensure_dir<'a>(&'a self, path: &'a str) -> BoxFuture<'a, ()> {
        self.paths
            .ensure_dir_calls
            .lock_recover()
            .push(path.to_string());
        Box::pin(async {})
    }
    fn fork_snapshots_dir(&self) -> String {
        self.paths
            .fork_snapshots_dir
            .lock_recover()
            .clone()
            .unwrap_or_else(|| temp_default("mainframe-fork-snapshots-test-default"))
    }
    fn history_cache_dir(&self) -> String {
        self.paths
            .history_cache_dir
            .lock_recover()
            .clone()
            .unwrap_or_else(|| temp_default("mainframe-history-cache-test-default"))
    }
}
