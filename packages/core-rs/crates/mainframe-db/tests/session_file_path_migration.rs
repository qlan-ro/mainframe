//! Ported from `packages/core/src/db/__tests__/session-file-path-migration.test.ts`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rusqlite::Connection;

use mainframe_db::schema::initialize_schema;

#[test]
fn adds_session_file_path_column_and_is_idempotent() {
    let db = Connection::open_in_memory().unwrap();
    initialize_schema(&db).unwrap();
    initialize_schema(&db).unwrap();
    let mut stmt = db.prepare("PRAGMA table_info(chats)").unwrap();
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert!(cols.iter().any(|c| c == "session_file_path"));
}
