//! Moves a database left at the legacy location (the config directory, where
//! releases that ignored `dataDir` kept it) to the configured data directory.
//!
//! The move never blocks a boot: when it cannot finish, the legacy database is
//! opened for this boot and the move is retried on the next one.

use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use crate::DbError;

/// SQLite's write-ahead log and shared-memory index, named `<db>-wal`/`<db>-shm`.
const SIDECAR_SUFFIXES: [&str; 2] = ["-wal", "-shm"];

/// `<db_path><suffix>`, the way SQLite names a database's companion files.
fn with_suffix(db_path: &Path, suffix: &str) -> PathBuf {
    let mut name = db_path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// Picks the database file to open this boot.
///
/// Returns `db_path` unless a database exists only at `legacy_db_path`; then it
/// moves that database to `db_path` first, and returns `legacy_db_path` when the
/// move fails so the daemon still starts with its data.
pub(crate) fn resolve_database_path(db_path: &Path, legacy_db_path: &Path) -> PathBuf {
    if db_path == legacy_db_path || !legacy_db_path.exists() {
        return db_path.to_path_buf();
    }
    if db_path.exists() {
        tracing::warn!(
            reason = "database_in_both_locations",
            configured = %db_path.display(),
            legacy = %legacy_db_path.display(),
            "a database exists in the configured data directory and at the legacy location; opening the configured one and leaving the legacy one untouched"
        );
        return db_path.to_path_buf();
    }
    tracing::info!(
        from = %legacy_db_path.display(),
        to = %db_path.display(),
        "moving database to the configured data directory"
    );
    match relocate(legacy_db_path, db_path) {
        Ok(()) => db_path.to_path_buf(),
        Err(err) => {
            tracing::warn!(
                reason = "database_move_failed",
                error = %err,
                legacy = %legacy_db_path.display(),
                configured = %db_path.display(),
                "could not move the database to the configured data directory; opening the legacy database for this boot"
            );
            legacy_db_path.to_path_buf()
        }
    }
}

/// Folds the legacy WAL into the main file, then moves only that file, so the
/// database is never split across two directories.
fn relocate(source: &Path, destination: &Path) -> Result<(), DbError> {
    if let Some(dir) = destination.parent() {
        fs::create_dir_all(dir)?;
    }
    let _exclusion = checkpoint_exclusively(source)?;
    remove_stray_sidecars(destination)?;
    remove_drained_sidecars(source)?;
    move_file(source, destination)
}

/// Sidecars with no database beside them belong to nothing; SQLite would apply
/// such a WAL to the database moved in, so they are deleted first.
fn remove_stray_sidecars(db_path: &Path) -> Result<(), DbError> {
    for suffix in SIDECAR_SUFFIXES {
        let stray = with_suffix(db_path, suffix);
        if fs::symlink_metadata(&stray).is_ok() {
            tracing::warn!(
                reason = "stray_sqlite_sidecar",
                path = %stray.display(),
                "removing a SQLite sidecar file that has no database next to it"
            );
            fs::remove_file(&stray)?;
        }
    }
    Ok(())
}

fn checkpoint_exclusively(db_path: &Path) -> Result<Connection, DbError> {
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(std::time::Duration::ZERO)?;
    // Leaving WAL requires idle WAL connections to release their shared locks too.
    conn.execute_batch(
        "PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE;",
    )?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))?;
    Ok(conn)
}

/// Reject leftover WAL frames before publishing the database.
fn remove_drained_sidecars(db_path: &Path) -> Result<(), DbError> {
    let wal = with_suffix(db_path, "-wal");
    match fs::metadata(&wal) {
        Ok(meta) if meta.len() > 0 => {
            return Err(DbError::Message(format!(
                "{} still holds {} bytes after a checkpoint",
                wal.display(),
                meta.len()
            )));
        }
        Ok(_) => fs::remove_file(&wal)?,
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err.into()),
    }
    let shm = with_suffix(db_path, "-shm");
    match fs::remove_file(&shm) {
        Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err.into()),
        _ => Ok(()),
    }
}

/// Renames, falling back to a verified copy when the two paths are on
/// different volumes (`EXDEV`), which `rename` cannot cross.
fn move_file(source: &Path, destination: &Path) -> Result<(), DbError> {
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::CrossesDevices => {
            copy_across_devices(source, destination)
        }
        Err(err) => Err(err.into()),
    }
}

/// Copies `source` to `<destination>.partial`, fsyncs it, checks its length,
/// renames it into place and only then removes `source`. A failure before the
/// rename leaves `source` intact and no file at `destination`.
pub(crate) fn copy_across_devices(source: &Path, destination: &Path) -> Result<(), DbError> {
    let partial = with_suffix(destination, ".partial");
    let placed = copy_synced(source, &partial)
        .and_then(|()| fs::rename(&partial, destination).map_err(DbError::from));
    if let Err(err) = placed {
        if let Err(cleanup) = fs::remove_file(&partial)
            && cleanup.kind() != io::ErrorKind::NotFound
        {
            tracing::warn!(path = %partial.display(), error = %cleanup, "could not remove a partial database copy");
        }
        return Err(err);
    }
    sync_parent_dir(destination);
    if let Err(err) = fs::remove_file(source) {
        // The full copy is in place and is what later boots open; the legacy
        // file is only a leftover now.
        tracing::warn!(
            reason = "legacy_database_not_removed",
            legacy = %source.display(),
            configured = %destination.display(),
            error = %err,
            "database copied to the configured data directory but the legacy copy could not be removed"
        );
    }
    Ok(())
}

fn copy_synced(source: &Path, target: &Path) -> Result<(), DbError> {
    let expected = fs::metadata(source)?.len();
    fs::copy(source, target)?;
    let file = OpenOptions::new().write(true).open(target)?;
    file.sync_all()?;
    let written = file.metadata()?.len();
    if written != expected {
        return Err(DbError::Message(format!(
            "copy of {} to {} has {written} bytes, expected {expected}",
            source.display(),
            target.display()
        )));
    }
    Ok(())
}

/// Persists the rename itself. Best effort: the data is already synced, and a
/// failure here only matters on a power loss in the next few seconds.
fn sync_parent_dir(path: &Path) {
    #[cfg(unix)]
    if let Some(dir) = path.parent()
        && let Err(err) = fs::File::open(dir).and_then(|dir| dir.sync_all())
    {
        tracing::warn!(dir = %dir.display(), error = %err, "could not fsync the data directory after moving the database");
    }
    #[cfg(not(unix))]
    let _ = path; /* expected: directories cannot be fsynced here */
}

#[cfg(test)]
#[path = "relocation_tests.rs"]
mod tests;
