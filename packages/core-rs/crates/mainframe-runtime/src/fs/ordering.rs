use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Weak};

use tokio::sync::Mutex;

use super::AtomicWriteError;

type Registry = HashMap<PathBuf, Weak<Mutex<()>>>;
pub(super) static WRITERS: LazyLock<Mutex<Registry>> = LazyLock::new(Mutex::default);

pub(super) async fn for_path(path: &Path) -> Result<Arc<Mutex<()>>, AtomicWriteError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = tokio::fs::canonicalize(parent)
        .await
        .map_err(|error| AtomicWriteError::write(path, error))?;
    // Rename replaces the directory entry, including a final symlink, not its target.
    let key = parent.join(path.file_name().unwrap_or_default());
    let mut writers = WRITERS.lock().await;
    writers.retain(|_, writer| writer.strong_count() > 0);
    if let Some(writer) = writers.get(&key).and_then(Weak::upgrade) {
        return Ok(writer);
    }
    let writer = Arc::new(Mutex::new(()));
    writers.insert(key, Arc::downgrade(&writer));
    Ok(writer)
}
