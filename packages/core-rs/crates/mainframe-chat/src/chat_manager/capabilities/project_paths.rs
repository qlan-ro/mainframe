use super::*;

pub trait ProjectPaths: Send + Sync {
    fn projects_get_path(&self, project_id: &str) -> Option<String>;

    fn projects_remove(&self, project_id: &str) -> Result<(), SeamError>;

    fn path_exists(&self, path: &str) -> bool;

    fn ensure_dir<'a>(&'a self, path: &'a str) -> BoxFuture<'a, ()>;

    fn fork_snapshots_dir(&self) -> String {
        std::env::temp_dir()
            .join("mainframe-fork-snapshots")
            .to_string_lossy()
            .into_owned()
    }

    fn history_cache_dir(&self) -> String {
        std::env::temp_dir()
            .join("mainframe-history-cache")
            .to_string_lossy()
            .into_owned()
    }
}
