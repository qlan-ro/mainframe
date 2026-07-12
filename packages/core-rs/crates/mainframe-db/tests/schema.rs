//! Ported from `packages/core/src/db/__tests__/schema.test.ts`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rusqlite::Connection;

use mainframe_db::schema::initialize_schema;

const NOW: &str = "2026-01-01T00:00:00.000Z";

fn seed_project_and_chat(db: &Connection) {
    db.execute(
        "INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)",
        rusqlite::params!["p1", "p", "/tmp/p", NOW, NOW],
    )
    .unwrap();
    db.execute(
        "INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        rusqlite::params!["c1", "claude", "p1", "active", NOW, NOW],
    )
    .unwrap();
}

#[test]
fn creates_tags_and_chat_tags_tables() {
    let db = Connection::open_in_memory().unwrap();
    initialize_schema(&db).unwrap();
    let mut stmt = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .unwrap();
    let names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert!(names.iter().any(|n| n == "tags"));
    assert!(names.iter().any(|n| n == "chat_tags"));
}

#[test]
fn chat_tags_cascades_on_chat_deletion() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&db).unwrap();
    seed_project_and_chat(&db);
    db.execute(
        "INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)",
        rusqlite::params!["feature", "blue", NOW],
    )
    .unwrap();
    db.execute(
        "INSERT INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)",
        rusqlite::params!["c1", "feature", NOW],
    )
    .unwrap();
    db.execute("DELETE FROM chats WHERE id = ?", ["c1"])
        .unwrap();
    let remaining: i64 = db
        .query_row("SELECT COUNT(*) AS n FROM chat_tags", [], |r| r.get(0))
        .unwrap();
    assert_eq!(remaining, 0);
}

#[test]
fn chat_tags_follows_tag_renames_via_on_update_cascade() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&db).unwrap();
    seed_project_and_chat(&db);
    db.execute(
        "INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)",
        rusqlite::params!["feat", "blue", NOW],
    )
    .unwrap();
    db.execute(
        "INSERT INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)",
        rusqlite::params!["c1", "feat", NOW],
    )
    .unwrap();

    db.execute(
        "UPDATE tags SET name = ? WHERE name = ?",
        ["feature", "feat"],
    )
    .unwrap();

    let tag: String = db
        .query_row("SELECT tag FROM chat_tags WHERE chat_id = ?", ["c1"], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(tag, "feature");
}

#[test]
fn rejects_deleting_a_tag_that_is_still_applied() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&db).unwrap();
    seed_project_and_chat(&db);
    db.execute(
        "INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)",
        rusqlite::params!["feature", "blue", NOW],
    )
    .unwrap();
    db.execute(
        "INSERT INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)",
        rusqlite::params!["c1", "feature", NOW],
    )
    .unwrap();

    let err = db
        .execute("DELETE FROM tags WHERE name = ?", ["feature"])
        .unwrap_err();
    assert!(err.to_string().to_lowercase().contains("foreign key"));
}
