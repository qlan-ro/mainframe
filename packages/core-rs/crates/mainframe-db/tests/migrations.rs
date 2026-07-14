//! Ported from `packages/core/src/db/__tests__/migrations.test.ts`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rusqlite::Connection;

use mainframe_db::migrations::{LATEST_VERSION, migrations, run_migrations};
use mainframe_db::schema::initialize_schema;

fn user_version(db: &Connection) -> i64 {
    db.pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}

fn column_names(db: &Connection, table: &str) -> Vec<String> {
    let mut stmt = db.prepare(&format!("PRAGMA table_info({table})")).unwrap();
    stmt.query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

// Every table's CREATE statement, in a stable order — the on-disk schema identity.
fn schema_sql(db: &Connection) -> String {
    let mut stmt = db
        .prepare(
            "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name",
        )
        .unwrap();
    let sqls: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(2))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    sqls.join("\n")
}

const ALL_CHATS_COLUMNS: [&str; 31] = [
    "id",
    "adapter_id",
    "project_id",
    "title",
    "claude_session_id",
    "model",
    "status",
    "created_at",
    "updated_at",
    "total_cost",
    "total_tokens_input",
    "total_tokens_output",
    "mentions",
    "modified_files",
    "plan_files",
    "skill_files",
    "permission_mode",
    "worktree_path",
    "branch_name",
    "process_state",
    "last_context_tokens_input",
    "todos",
    "pinned",
    "effort",
    "fast",
    "ultracode",
    "adaptive_thinking",
    "detected_prs",
    "plan_mode",
    "session_file_path",
    "automation_run_id",
];

// Builds an intermediate historical DB by replaying the real migration chain up to
// a point *before* the backfills, then resets user_version to 0 (as the old code
// left it) and seeds rows that exercise every data backfill.
fn build_legacy_intermediate() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    // Stop before migration 19 (plan_mode) so permission_mode='plan' survives to be backfilled.
    run_migrations(&db, 18).unwrap();

    let now = "2026-01-01T00:00:00.000Z";
    db.execute(
        "INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)",
        rusqlite::params!["p1", "proj", "/tmp/p1", now, now],
    )
    .unwrap();
    // claude-sdk row (exercises the claude rename) with permission_mode='plan' (exercises plan_mode).
    db.execute(
        "INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at, permission_mode) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params!["c1", "claude-sdk", "p1", "active", now, now, "plan"],
    )
    .unwrap();
    db.execute(
        "INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at, permission_mode) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params!["c2", "codex", "p1", "active", now, now, "default"],
    )
    .unwrap();
    // provider defaultMode='plan' (exercises the settings backfill).
    db.execute(
        "INSERT INTO settings (id, category, key, value, updated_at) VALUES (?, ?, ?, ?, ?)",
        rusqlite::params!["s1", "provider", "claude.defaultMode", "plan", now],
    )
    .unwrap();

    // The old code never wrote user_version, so a real legacy DB reports 0.
    db.pragma_update(None, "user_version", 0_i64).unwrap();
    db
}

#[test]
fn latest_version_is_highest_migration_contiguous_from_1() {
    let versions: Vec<i64> = migrations().iter().map(|m| m.version).collect();
    let expected: Vec<i64> = (1..=versions.len() as i64).collect();
    assert_eq!(versions, expected);
    assert_eq!(LATEST_VERSION, *versions.last().unwrap());
}

#[test]
fn fresh_db_fast_paths_to_final_schema() {
    let db = Connection::open_in_memory().unwrap();
    initialize_schema(&db).unwrap();

    assert_eq!(user_version(&db), LATEST_VERSION);
    let cols = column_names(&db, "chats");
    for name in ALL_CHATS_COLUMNS {
        assert!(
            cols.iter().any(|c| c == name),
            "missing chats column {name}"
        );
    }
    assert!(
        column_names(&db, "projects")
            .iter()
            .any(|c| c == "parent_project_id")
    );
    assert!(
        column_names(&db, "devices")
            .iter()
            .any(|c| c == "auth_epoch")
    );
}

#[test]
fn is_idempotent() {
    let db = Connection::open_in_memory().unwrap();
    initialize_schema(&db).unwrap();
    let sql_before = schema_sql(&db);
    initialize_schema(&db).unwrap();
    assert_eq!(user_version(&db), LATEST_VERSION);
    assert_eq!(schema_sql(&db), sql_before);
}

#[test]
fn detects_legacy_db_and_stamps_without_rebreaking() {
    let db = Connection::open_in_memory().unwrap();
    initialize_schema(&db).unwrap();
    let sql_before = schema_sql(&db);

    // Simulate a DB written by the old ad-hoc code: fully migrated but never stamped.
    db.pragma_update(None, "user_version", 0_i64).unwrap();
    assert_eq!(user_version(&db), 0);

    initialize_schema(&db).unwrap();
    assert_eq!(user_version(&db), LATEST_VERSION);
    assert_eq!(schema_sql(&db), sql_before);
}

#[test]
fn applies_every_data_backfill_when_upgrading_legacy_intermediate() {
    let db = build_legacy_intermediate();
    initialize_schema(&db).unwrap();

    assert_eq!(user_version(&db), LATEST_VERSION);

    // claude-sdk → claude rename
    let mut stmt = db
        .prepare("SELECT id, adapter_id FROM chats ORDER BY id")
        .unwrap();
    let adapters: Vec<(String, String)> = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        adapters,
        vec![
            ("c1".to_string(), "claude".to_string()),
            ("c2".to_string(), "codex".to_string())
        ]
    );

    // plan permission-mode → plan_mode
    let mut stmt = db
        .prepare("SELECT id, permission_mode, plan_mode FROM chats ORDER BY id")
        .unwrap();
    let plan_rows: Vec<(String, Option<String>, i64)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        plan_rows[0],
        ("c1".to_string(), Some("default".to_string()), 1)
    );
    assert_eq!(
        plan_rows[1],
        ("c2".to_string(), Some("default".to_string()), 0)
    );

    // provider defaultMode → defaultPlanMode
    let mode: String = db
        .query_row(
            "SELECT value FROM settings WHERE category='provider' AND key='claude.defaultMode'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(mode, "default");
    let plan_mode: String = db
        .query_row(
            "SELECT value FROM settings WHERE category='provider' AND key='claude.defaultPlanMode'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(plan_mode, "true");
}

#[test]
fn produces_byte_identical_final_schema_fresh_vs_migrated() {
    let fresh = Connection::open_in_memory().unwrap();
    initialize_schema(&fresh).unwrap();

    let migrated = build_legacy_intermediate();
    initialize_schema(&migrated).unwrap();

    assert_eq!(schema_sql(&migrated), schema_sql(&fresh));
    assert_eq!(user_version(&migrated), user_version(&fresh));
}
