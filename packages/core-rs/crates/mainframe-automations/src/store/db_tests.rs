//! T2.1 — DB open + contract DDL (plan §Phase 2; contract §3).

use rusqlite::Connection;
use tempfile::TempDir;

use super::db::AutomationDb;

fn db_path(dir: &TempDir) -> std::path::PathBuf {
    dir.path().join("automations.db")
}

/// Runs a synchronous probe against the store's own connection.
async fn probe<R: Send + 'static>(
    db: &AutomationDb,
    f: impl FnOnce(&Connection) -> R + Send + 'static,
) -> R {
    db.call(move |conn| Ok(f(conn))).await.unwrap()
}

#[tokio::test]
async fn open_creates_the_three_contract_tables() {
    let dir = TempDir::new().unwrap();
    let db = AutomationDb::open(db_path(&dir)).await.unwrap();
    let tables: Vec<String> = probe(&db, |conn| {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    })
    .await;
    for expected in ["automations", "automation_runs", "automation_interactions"] {
        assert!(tables.iter().any(|t| t == expected), "missing {expected}");
    }
}

#[tokio::test]
async fn runs_table_has_dedup_column_and_contract_indexes() {
    let dir = TempDir::new().unwrap();
    let db = AutomationDb::open(db_path(&dir)).await.unwrap();

    let columns: Vec<String> = probe(&db, |conn| {
        let mut stmt = conn.prepare("PRAGMA table_info(automation_runs)").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    })
    .await;
    assert!(columns.iter().any(|c| c == "trigger_dedup_key"));

    let indexes: Vec<(String, Option<String>)> = probe(&db, |conn| {
        let mut stmt = conn
            .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    })
    .await;

    let sql_of = |name: &str| -> String {
        indexes
            .iter()
            .find(|(n, _)| n == name)
            .unwrap_or_else(|| panic!("missing index {name}"))
            .1
            .clone()
            .unwrap_or_default()
    };
    let dedup = sql_of("uq_runs_dedup");
    assert!(dedup.contains("UNIQUE"), "uq_runs_dedup must be UNIQUE");
    assert!(dedup.contains("automation_id") && dedup.contains("trigger_dedup_key"));
    assert!(sql_of("idx_runs_automation").contains("started_at DESC"));
    let live = sql_of("idx_runs_live");
    assert!(live.contains("WHERE") && live.contains("running") && live.contains("waiting"));
    assert!(sql_of("idx_interactions_pending").contains("status"));
}

#[tokio::test]
async fn pragmas_wal_busy_timeout_foreign_keys_user_version() {
    let dir = TempDir::new().unwrap();
    let db = AutomationDb::open(db_path(&dir)).await.unwrap();
    let (journal, busy, fk, version) = probe(&db, |conn| {
        let journal: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        let busy: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
            .unwrap();
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        (journal, busy, fk, version)
    })
    .await;
    assert_eq!(journal.to_lowercase(), "wal");
    assert_eq!(busy, 5000);
    assert_eq!(fk, 1);
    assert_eq!(version, 1);
}

#[tokio::test]
async fn reopen_is_a_no_op_and_preserves_rows() {
    let dir = TempDir::new().unwrap();
    let path = db_path(&dir);
    {
        let db = AutomationDb::open(&path).await.unwrap();
        probe(&db, |conn| {
            conn.execute(
                "INSERT INTO automations (id, name, scope, definition, created_at, updated_at)
                 VALUES ('a1', 'n', 'global', '{}', 1, 1)",
                [],
            )
            .unwrap();
        })
        .await;
    }
    let db = AutomationDb::open(&path).await.unwrap();
    let count: i64 = probe(&db, |conn| {
        conn.query_row("SELECT COUNT(*) FROM automations", [], |r| r.get(0))
            .unwrap()
    })
    .await;
    assert_eq!(count, 1);
}

#[tokio::test]
async fn unknown_tables_survive_open() {
    let dir = TempDir::new().unwrap();
    let path = db_path(&dir);
    {
        // Pre-seed a foreign engine's private table (Node's trigger_state).
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE trigger_state (automation_id TEXT, trigger_id TEXT);
             INSERT INTO trigger_state VALUES ('a', 't');",
        )
        .unwrap();
    }
    let db = AutomationDb::open(&path).await.unwrap();
    let count: i64 = probe(&db, |conn| {
        conn.query_row("SELECT COUNT(*) FROM trigger_state", [], |r| r.get(0))
            .unwrap()
    })
    .await;
    assert_eq!(count, 1);
}

#[tokio::test]
async fn open_creates_parent_directories() {
    let dir = TempDir::new().unwrap();
    let nested = dir.path().join("data/sub/automations.db");
    AutomationDb::open(&nested).await.unwrap();
    assert!(nested.exists());
}
