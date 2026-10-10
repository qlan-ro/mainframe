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
    remove_stray_sidecars(destination)?;
    checkpoint(source)?;
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

/// Opens the database, copies every WAL frame into the main file and empties
/// the WAL (`TRUNCATE`), then closes it.
fn checkpoint(db_path: &Path) -> Result<(), DbError> {
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    // Reading the schema rejects a file that is not a database and replays a
    // WAL left by a crash before the checkpoint runs.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))?;
    let busy: i64 = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))?;
    if busy != 0 {
        return Err(DbError::Message(format!(
            "{} is in use by another process; its write-ahead log could not be checkpointed",
            db_path.display()
        )));
    }
    conn.close().map_err(|(_, err)| DbError::from(err))
}

/// After a successful checkpoint the WAL is empty (or already deleted by the
/// close) and the shared-memory index describes nothing, so both can go. A WAL
/// that still holds frames would lose data if left behind, so it aborts the move.
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
mod tests {
    use super::*;
    use mainframe_runtime::log_capture::LogCapture;
    use tempfile::tempdir;

    fn create_db(path: &Path, value: &str) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL; CREATE TABLE proof (value TEXT);")
            .unwrap();
        conn.execute("INSERT INTO proof VALUES (?1)", [value])
            .unwrap();
    }

    fn read_values(path: &Path) -> Vec<String> {
        let conn = Connection::open(path).unwrap();
        let mut stmt = conn
            .prepare("SELECT value FROM proof ORDER BY rowid")
            .unwrap();
        stmt.query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn file_names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn copy_across_devices_places_a_full_copy_and_removes_the_source() {
        let root = tempdir().unwrap();
        let source = root.path().join("legacy.db");
        let destination = root.path().join("configured.db");
        fs::write(&source, b"0123456789").unwrap();

        copy_across_devices(&source, &destination).unwrap();

        assert_eq!(fs::read(&destination).unwrap(), b"0123456789");
        assert_eq!(file_names(root.path()), vec!["configured.db"]);
    }

    #[test]
    fn copy_across_devices_keeps_the_source_when_the_copy_fails() {
        let root = tempdir().unwrap();
        let source = root.path().join("legacy.db");
        let destination = root.path().join("missing-dir").join("configured.db");
        fs::write(&source, b"0123456789").unwrap();

        assert!(copy_across_devices(&source, &destination).is_err());

        assert_eq!(fs::read(&source).unwrap(), b"0123456789");
        assert_eq!(file_names(root.path()), vec!["legacy.db"]);
    }

    #[test]
    fn moves_the_database_with_its_uncheckpointed_wal_contents() {
        let root = tempdir().unwrap();
        let origin = root.path().join("origin");
        let legacy_dir = root.path().join("legacy");
        let data_dir = root.path().join("configured");
        fs::create_dir_all(&origin).unwrap();
        fs::create_dir_all(&legacy_dir).unwrap();
        create_db(&origin.join("mainframe.db"), "checkpointed");
        // Leave a committed row only in the WAL, then snapshot the files the
        // way a crash would leave them.
        let conn = Connection::open(origin.join("mainframe.db")).unwrap();
        conn.execute_batch("PRAGMA wal_autocheckpoint = 0; INSERT INTO proof VALUES ('wal-only');")
            .unwrap();
        fs::copy(origin.join("mainframe.db"), legacy_dir.join("mainframe.db")).unwrap();
        fs::copy(
            origin.join("mainframe.db-wal"),
            legacy_dir.join("mainframe.db-wal"),
        )
        .unwrap();
        drop(conn);
        assert!(
            fs::metadata(legacy_dir.join("mainframe.db-wal"))
                .unwrap()
                .len()
                > 0
        );

        let db_path = data_dir.join("mainframe.db");
        let opened = resolve_database_path(&db_path, &legacy_dir.join("mainframe.db"));

        assert_eq!(opened, db_path);
        assert_eq!(file_names(&legacy_dir), Vec::<String>::new());
        assert_eq!(file_names(&data_dir), vec!["mainframe.db"]);
        assert_eq!(read_values(&db_path), vec!["checkpointed", "wal-only"]);
    }

    #[test]
    fn removes_stray_sidecars_at_the_destination_before_moving() {
        let root = tempdir().unwrap();
        let legacy_dir = root.path().join("legacy");
        let data_dir = root.path().join("configured");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::create_dir_all(&data_dir).unwrap();
        create_db(&legacy_dir.join("mainframe.db"), "legacy");
        fs::write(data_dir.join("mainframe.db-wal"), b"stale wal").unwrap();
        fs::write(data_dir.join("mainframe.db-shm"), b"stale shm").unwrap();

        let (subscriber, events) = LogCapture::install();
        let db_path = data_dir.join("mainframe.db");
        let opened = tracing::subscriber::with_default(subscriber, || {
            resolve_database_path(&db_path, &legacy_dir.join("mainframe.db"))
        });

        assert_eq!(opened, db_path);
        assert_eq!(file_names(&data_dir), vec!["mainframe.db"]);
        assert_eq!(file_names(&legacy_dir), Vec::<String>::new());
        assert_eq!(read_values(&db_path), vec!["legacy"]);
        assert_eq!(
            LogCapture::events_with_reason(&events),
            vec![
                (tracing::Level::WARN, "stray_sqlite_sidecar".to_string()),
                (tracing::Level::WARN, "stray_sqlite_sidecar".to_string()),
            ]
        );
    }

    #[test]
    fn same_location_is_left_alone() {
        let root = tempdir().unwrap();
        let db_path = root.path().join("mainframe.db");
        create_db(&db_path, "in place");

        let opened = resolve_database_path(&db_path, &db_path);

        assert_eq!(opened, db_path);
        assert_eq!(file_names(root.path()), vec!["mainframe.db"]);
        assert_eq!(read_values(&db_path), vec!["in place"]);
    }

    #[test]
    fn database_in_both_locations_keeps_the_configured_one_and_warns() {
        let root = tempdir().unwrap();
        let legacy_db = root.path().join("legacy.db");
        let db_path = root.path().join("configured.db");
        create_db(&legacy_db, "legacy");
        create_db(&db_path, "configured");

        let (subscriber, events) = LogCapture::install();
        let opened = tracing::subscriber::with_default(subscriber, || {
            resolve_database_path(&db_path, &legacy_db)
        });

        assert_eq!(opened, db_path);
        assert_eq!(read_values(&legacy_db), vec!["legacy"]);
        assert_eq!(
            LogCapture::events_with_reason(&events),
            vec![(
                tracing::Level::WARN,
                "database_in_both_locations".to_string()
            )]
        );
    }

    #[test]
    fn failed_move_opens_the_legacy_database_and_warns() {
        let root = tempdir().unwrap();
        let legacy_db = root.path().join("legacy.db");
        create_db(&legacy_db, "legacy");
        // A regular file where the data directory should be: it cannot be
        // created, whatever the test runner's privileges.
        let blocked = root.path().join("blocked");
        fs::write(&blocked, b"not a directory").unwrap();
        let db_path = blocked.join("mainframe.db");

        let (subscriber, events) = LogCapture::install();
        let opened = tracing::subscriber::with_default(subscriber, || {
            resolve_database_path(&db_path, &legacy_db)
        });

        assert_eq!(opened, legacy_db);
        assert_eq!(read_values(&legacy_db), vec!["legacy"]);
        assert_eq!(
            LogCapture::events_with_reason(&events),
            vec![(tracing::Level::WARN, "database_move_failed".to_string())]
        );
    }
}
