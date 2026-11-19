use super::*;
use crate::DatabaseManager;
use mainframe_types::compaction::CompactionOrigin;

fn request() -> NativeCompactionRequest {
    NativeCompactionRequest {
        id: "idle-compact:c:run-1".into(),
        session_generation: "session".into(),
        origin: CompactionOrigin::Idle,
        command_uuid: "command".into(),
    }
}

fn seed(db: &Connection) {
    db.execute(
        "INSERT INTO projects(id,name,path,created_at,last_opened_at) VALUES ('p','p','/p','','')",
        [],
    )
    .unwrap();
    db.execute("INSERT INTO chats(id,project_id,adapter_id,status,created_at,updated_at) VALUES ('c','p','claude','active','','')", []).unwrap();
}

#[test]
fn claim_survives_reopen_and_new_run_rearms() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.db");
    let db = DatabaseManager::open(&path).unwrap();
    seed(db.connection());
    assert!(get(db.connection(), "c").unwrap().is_none());
    begin(db.connection(), "c", "run-1").unwrap();
    assert!(!claim(db.connection(), "c", "run-1", &request()).unwrap());
    complete(db.connection(), "c", "run-1", Some(42)).unwrap();
    assert!(!claim(db.connection(), "c", "stale", &request()).unwrap());
    assert!(claim(db.connection(), "c", "run-1", &request()).unwrap());
    begin(db.connection(), "c", "run-1").unwrap();
    complete(db.connection(), "c", "run-1", Some(99)).unwrap();
    assert_eq!(
        get(db.connection(), "c").unwrap().unwrap().completed_ms,
        Some(42)
    );
    assert!(get(db.connection(), "c").unwrap().unwrap().claim.is_some());
    drop(db);
    let db = DatabaseManager::open(&path).unwrap();
    assert!(!claim(db.connection(), "c", "run-1", &request()).unwrap());
    assert_eq!(
        get(db.connection(), "c").unwrap().unwrap().completed_ms,
        Some(42)
    );
    begin(db.connection(), "c", "run-2").unwrap();
    complete(db.connection(), "c", "run-1", Some(99)).unwrap();
    assert!(
        get(db.connection(), "c")
            .unwrap()
            .unwrap()
            .completed_ms
            .is_none()
    );
    complete(db.connection(), "c", "run-2", Some(100)).unwrap();
    let mut next = request();
    next.id = "idle-compact:c:run-2".into();
    assert!(claim(db.connection(), "c", "run-2", &next).unwrap());
}

#[test]
fn provenance_requires_matching_claim_and_deduplicates() {
    let db = DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
    seed(db.connection());
    let request = request();
    let mut metadata = request.metadata(Some("boundary"));
    assert!(!record(db.connection(), "c", &metadata).unwrap());
    begin(db.connection(), "c", "run-1").unwrap();
    complete(db.connection(), "c", "run-1", Some(42)).unwrap();
    assert!(claim(db.connection(), "c", "run-1", &request).unwrap());
    metadata.session_generation = "old".into();
    assert!(!record(db.connection(), "c", &metadata).unwrap());
    metadata.session_generation = request.session_generation;
    metadata.before_tokens = Some(21_000);
    metadata.after_tokens = Some(2_000);
    assert!(record(db.connection(), "c", &metadata).unwrap());
    assert!(!record(db.connection(), "c", &metadata).unwrap());
    assert_eq!(provenance(db.connection(), "c").unwrap(), vec![metadata]);
}

#[test]
fn storage_failure_cannot_claim() {
    let db = DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
    db.connection()
        .execute("DROP TABLE idle_compaction_runs", [])
        .unwrap();
    assert!(claim(db.connection(), "c", "run-1", &request()).is_err());
}

#[test]
fn codex_completion_without_command_uuid_and_legacy_id_upgrade() {
    let db = DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
    seed(db.connection());
    db.connection()
        .execute("UPDATE chats SET adapter_id='codex' WHERE id='c'", [])
        .unwrap();
    let request = request();
    begin(db.connection(), "c", "run-1").unwrap();
    complete(db.connection(), "c", "run-1", Some(42)).unwrap();
    assert!(claim(db.connection(), "c", "run-1", &request).unwrap());
    let mut metadata = request.metadata(None);
    metadata.command_uuid = None;
    assert!(record(db.connection(), "c", &metadata).unwrap());
    let original = markers(db.connection(), "c").unwrap();
    metadata.vendor_id = Some("canonical-id".into());
    assert!(record(db.connection(), "c", &metadata).unwrap());
    assert!(!record(db.connection(), "c", &metadata).unwrap());
    let upgraded = markers(db.connection(), "c").unwrap();
    assert_eq!(upgraded[0].id, request.id);
    assert_eq!(upgraded[0].timestamp, original[0].timestamp);
    assert_eq!(provenance(db.connection(), "c").unwrap(), vec![metadata]);
}

#[test]
fn completed_and_failed_outcomes_are_terminal_for_the_generation() {
    let db = DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
    seed(db.connection());
    begin(db.connection(), "c", "run-1").unwrap();
    complete(db.connection(), "c", "run-1", Some(42)).unwrap();
    complete(db.connection(), "c", "run-1", Some(99)).unwrap();
    assert_eq!(
        get(db.connection(), "c").unwrap().unwrap().completed_ms,
        Some(42)
    );
    begin(db.connection(), "c", "failed").unwrap();
    complete(db.connection(), "c", "failed", None).unwrap();
    begin(db.connection(), "c", "failed").unwrap();
    complete(db.connection(), "c", "failed", Some(99)).unwrap();
    assert!(
        get(db.connection(), "c")
            .unwrap()
            .unwrap()
            .completed_ms
            .is_none()
    );
}
