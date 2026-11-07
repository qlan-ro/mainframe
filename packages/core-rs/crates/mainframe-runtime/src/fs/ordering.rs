use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

use tokio::sync::Mutex;

use super::AtomicWriteError;
use crate::sync::KeyedMutex;

pub(super) static WRITERS: LazyLock<KeyedMutex> = LazyLock::new(KeyedMutex::default);

pub(super) async fn for_path(path: &Path) -> Result<Arc<Mutex<()>>, AtomicWriteError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = tokio::fs::canonicalize(parent)
        .await
        .map_err(|error| AtomicWriteError::write(path, error))?;
    // Rename replaces the directory entry, including a final symlink, not its target.
    let key: PathBuf = parent.join(path.file_name().unwrap_or_default());
    Ok(WRITERS.get(&key.to_string_lossy()))
}
