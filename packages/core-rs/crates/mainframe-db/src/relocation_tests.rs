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

#[test]
fn idle_wal_connection_prevents_relocation_and_can_keep_writing() {
    let root = tempdir().unwrap();
    let source = root.path().join("legacy.db");
    let target = root.path().join("configured.db");
    create_db(&source, "original");
    let idle = Connection::open(&source).unwrap();
    idle.execute_batch("INSERT INTO proof VALUES ('before');")
        .unwrap();
    let checkpoint = Connection::open(&source).unwrap();
    let busy: i64 = checkpoint
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))
        .unwrap();
    assert_eq!(busy, 0);
    drop(checkpoint);
    assert_eq!(resolve_database_path(&target, &source), source);
    assert!(!target.exists());
    idle.execute_batch("INSERT INTO proof VALUES ('after');")
        .unwrap();
    assert_eq!(read_values(&source), vec!["original", "before", "after"]);
    drop(idle);
    assert_eq!(resolve_database_path(&target, &source), target);
    assert_eq!(read_values(&target), vec!["original", "before", "after"]);
}

#[test]
fn exclusion_survives_checkpoint_until_publication() {
    let root = tempdir().unwrap();
    let source = root.path().join("legacy.db");
    create_db(&source, "original");
    let guard = checkpoint_exclusively(&source).unwrap();
    let other = Connection::open(&source).unwrap();
    other.busy_timeout(std::time::Duration::ZERO).unwrap();
    remove_drained_sidecars(&source).unwrap();
    assert!(
        other
            .execute_batch("INSERT INTO proof VALUES ('blocked');")
            .is_err()
    );
    drop(guard);
    other
        .execute_batch("INSERT INTO proof VALUES ('released');")
        .unwrap();
    assert_eq!(read_values(&source), vec!["original", "released"]);
}

#[test]
fn failed_publication_releases_exclusion_and_preserves_source() {
    let root = tempdir().unwrap();
    let source = root.path().join("legacy.db");
    let destination = root.path().join("directory");
    create_db(&source, "original");
    fs::create_dir(&destination).unwrap();
    assert!(relocate(&source, &destination).is_err());
    let conn = Connection::open(&source).unwrap();
    conn.execute_batch("PRAGMA journal_mode = WAL; INSERT INTO proof VALUES ('after');")
        .unwrap();
    assert_eq!(read_values(&source), vec!["original", "after"]);
}

#[test]
fn cross_device_copy_publishes_checkpointed_data_under_exclusion() {
    let root = tempdir().unwrap();
    let source = root.path().join("legacy.db");
    let destination = root.path().join("configured.db");
    create_db(&source, "original");
    let guard = checkpoint_exclusively(&source).unwrap();
    remove_drained_sidecars(&source).unwrap();
    copy_across_devices(&source, &destination).unwrap();
    drop(guard);
    assert!(!source.exists());
    assert_eq!(read_values(&destination), vec!["original"]);
    assert_eq!(file_names(root.path()), vec!["configured.db"]);
}
