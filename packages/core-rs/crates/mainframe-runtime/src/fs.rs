use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::Mutex;

mod ordering;

/// Both arguments must already be canonical paths.
pub fn is_within_base(real_base: &Path, real_target: &Path) -> bool {
    real_target.starts_with(real_base)
}

/// Missing or escaping paths fail closed, including symlinks and absolute paths.
pub async fn resolve_and_validate_path(base: &str, requested: &str) -> Option<String> {
    let real_base = tokio::fs::canonicalize(base).await.ok()?;
    let target = tokio::fs::canonicalize(Path::new(base).join(requested))
        .await
        .ok()?;
    is_within_base(&real_base, &target).then(|| target.to_string_lossy().into_owned())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AtomicWriteStage {
    Write,
    Rename,
}

#[derive(Debug, thiserror::Error)]
#[error("{source}")]
pub struct AtomicWriteError {
    pub path: PathBuf,
    pub stage: AtomicWriteStage,
    #[source]
    pub source: io::Error,
}

impl AtomicWriteError {
    fn write(path: &Path, source: io::Error) -> Self {
        Self {
            path: path.to_path_buf(),
            stage: AtomicWriteStage::Write,
            source,
        }
    }
}

/// Writes a unique sibling, syncs its contents and metadata, then renames it.
/// The directory is not fsynced: replacement is atomic, not crash-durable.
/// `owner_only` sets Unix mode 0600 before any bytes are written.
/// Submitted writes stay serialized through publication after caller cancellation.
pub async fn write_atomic(
    path: &Path,
    contents: &[u8],
    owner_only: bool,
) -> Result<(), AtomicWriteError> {
    let ordering = ordering::for_path(path).await?;
    write_ordered(path, contents, owner_only, ordering, || {}).await
}

async fn write_ordered(
    path: &Path,
    contents: &[u8],
    owner_only: bool,
    ordering: Arc<Mutex<()>>,
    before_rename: impl FnOnce() + Send + 'static,
) -> Result<(), AtomicWriteError> {
    let guard = ordering.lock_owned().await;
    let path = path.to_path_buf();
    let contents = contents.to_vec();
    let error_path = path.clone();
    tokio::task::spawn_blocking(move || {
        let _guard = guard;
        write_atomic_blocking(&path, &contents, owner_only, before_rename)
    })
    .await
    .map_err(|error| AtomicWriteError::write(&error_path, io::Error::other(error)))?
}

fn write_atomic_blocking(
    path: &Path,
    contents: &[u8],
    owner_only: bool,
    before_rename: impl FnOnce(),
) -> Result<(), AtomicWriteError> {
    let (temporary, mut file) = create_sibling(path, owner_only)?;
    #[cfg(unix)]
    if owner_only {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|error| AtomicWriteError::write(&temporary.0, error))?;
    }
    file.write_all(contents)
        .map_err(|error| AtomicWriteError::write(&temporary.0, error))?;
    file.sync_all()
        .map_err(|error| AtomicWriteError::write(&temporary.0, error))?;
    drop(file);
    before_rename();
    std::fs::rename(&temporary.0, path).map_err(|source| AtomicWriteError {
        path: path.to_path_buf(),
        stage: AtomicWriteStage::Rename,
        source,
    })
}

fn create_sibling(
    path: &Path,
    owner_only: bool,
) -> Result<(Temporary, std::fs::File), AtomicWriteError> {
    loop {
        let mut name = path.as_os_str().to_os_string();
        name.push(format!(
            ".{}.{:016x}.tmp",
            std::process::id(),
            rand::random::<u64>()
        ));
        let temporary = PathBuf::from(name);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if owner_only {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        #[cfg(not(unix))]
        let _ = owner_only;
        match options.open(&temporary) {
            Ok(file) => return Ok((Temporary(temporary), file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(AtomicWriteError::write(&temporary, error)),
        }
    }
}

struct Temporary(PathBuf);

impl Drop for Temporary {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_file(&self.0)
            && error.kind() != io::ErrorKind::NotFound
        {
            tracing::warn!(%error, path = %self.0.display(), "atomic write cleanup failed");
        }
    }
}

#[cfg(test)]
mod cancellation_tests;
#[cfg(test)]
mod tests;
