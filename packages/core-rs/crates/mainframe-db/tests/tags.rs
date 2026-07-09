//! Ported from `packages/core/src/db/__tests__/tags.test.ts`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::rc::Rc;

use rusqlite::Connection;

use mainframe_db::TagsRepository;
use mainframe_db::schema::initialize_schema;
use mainframe_types::tags::TagColor;

const NOW: &str = "2026-01-01T00:00:00.000Z";

fn setup() -> TagsRepository {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&conn).unwrap();
    TagsRepository::new(Rc::new(conn))
}

fn seed_project_and_chat(conn: &Connection, chats: &[&str]) {
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)",
        rusqlite::params!["p1", "p", "/tmp/p", NOW, NOW],
    )
    .unwrap();
    for id in chats {
        conn.execute(
            "INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            rusqlite::params![id, "claude", "p1", "active", NOW, NOW],
        )
        .unwrap();
    }
}

#[test]
fn list_returns_empty_initially() {
    assert!(setup().list().unwrap().is_empty());
}

#[test]
fn upsert_creates_a_tag_with_auto_color_when_missing() {
    let repo = setup();
    let tag = repo.upsert("feature", None).unwrap();
    assert_eq!(tag.name, "feature");
    assert_eq!(repo.list().unwrap().len(), 1);
}

#[test]
fn upsert_is_idempotent() {
    let repo = setup();
    let a = repo.upsert("feature", None).unwrap();
    let b = repo.upsert("feature", None).unwrap();
    assert_eq!(b.color, a.color);
    assert_eq!(repo.list().unwrap().len(), 1);
}

#[test]
fn rejects_reserved_prefix() {
    let err = setup().upsert("has-pr", None).unwrap_err();
    assert!(err.to_string().to_lowercase().contains("reserved"));
}

#[test]
fn rename_moves_the_row_and_cascades_chat_tags() {
    let repo = setup();
    repo.upsert("feat", None).unwrap();
    repo.rename("feat", "feature").unwrap();
    let names: Vec<String> = repo.list().unwrap().into_iter().map(|t| t.name).collect();
    assert!(names.iter().any(|n| n == "feature"));
    assert!(!names.iter().any(|n| n == "feat"));
}

#[test]
fn rename_to_existing_name_merges() {
    let repo = setup();
    repo.upsert("feat", None).unwrap();
    repo.upsert("feature", None).unwrap();
    repo.rename("feat", "feature").unwrap();
    assert_eq!(repo.list().unwrap().len(), 1);
}

#[test]
fn recolor_updates_color_only() {
    let repo = setup();
    repo.upsert("feature", None).unwrap();
    repo.set_color("feature", TagColor::Red).unwrap();
    assert_eq!(repo.list().unwrap()[0].color, TagColor::Red);
}

#[test]
fn remove_deletes_the_row() {
    let repo = setup();
    repo.upsert("feature", None).unwrap();
    repo.remove("feature").unwrap();
    assert_eq!(repo.list().unwrap().len(), 0);
}

#[test]
fn upsert_normalizes_whitespace_and_case() {
    let repo = setup();
    let a = repo.upsert("  Feature  ", None).unwrap();
    assert_eq!(a.name, "feature");
}

#[test]
fn rename_to_self_is_a_no_op() {
    let repo = setup();
    repo.upsert("feature", None).unwrap();
    assert!(repo.rename("feature", "feature").is_ok());
    assert_eq!(repo.list().unwrap().len(), 1);
}

#[test]
fn upsert_ignores_color_arg_when_tag_already_exists() {
    let repo = setup();
    let first = repo.upsert("feature", None).unwrap(); // gets auto color
    let second = repo.upsert("feature", Some(TagColor::Red)).unwrap();
    assert_eq!(second.color, first.color);
}

#[test]
fn plain_rename_cascades_chat_tags_via_on_update_cascade() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&conn).unwrap();
    seed_project_and_chat(&conn, &["c1"]);
    let conn = Rc::new(conn);
    let repo = TagsRepository::new(Rc::clone(&conn));
    repo.upsert("feat", None).unwrap();
    conn.execute(
        "INSERT INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)",
        rusqlite::params!["c1", "feat", NOW],
    )
    .unwrap();
    repo.rename("feat", "feature").unwrap();
    let tag: String = conn
        .query_row("SELECT tag FROM chat_tags WHERE chat_id = ?", ["c1"], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(tag, "feature");
}

#[test]
fn merge_rename_moves_chat_tags_rows_under_the_target_tag() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&conn).unwrap();
    seed_project_and_chat(&conn, &["c1", "c2"]);
    let conn = Rc::new(conn);
    let repo = TagsRepository::new(Rc::clone(&conn));
    repo.upsert("feat", None).unwrap();
    repo.upsert("feature", None).unwrap();
    conn.execute(
        "INSERT INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)",
        rusqlite::params!["c1", "feat", NOW],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)",
        rusqlite::params!["c2", "feature", NOW],
    )
    .unwrap();
    repo.rename("feat", "feature").unwrap();
    let mut stmt = conn
        .prepare("SELECT tag FROM chat_tags ORDER BY chat_id")
        .unwrap();
    let tags: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(tags, vec!["feature".to_string(), "feature".to_string()]);
}

#[test]
fn get_returns_null_for_missing_tag() {
    assert!(setup().get("nonexistent").unwrap().is_none());
}

#[test]
fn rename_rejects_reserved_prefix_target() {
    let repo = setup();
    repo.upsert("feature", None).unwrap();
    let err = repo.rename("feature", "has-pr").unwrap_err();
    assert!(err.to_string().to_lowercase().contains("reserved"));
}

#[test]
fn set_color_throws_when_tag_missing() {
    let err = setup().set_color("nope", TagColor::Red).unwrap_err();
    assert!(err.to_string().to_lowercase().contains("not found"));
}

#[test]
fn remove_throws_when_tag_missing() {
    let err = setup().remove("nope").unwrap_err();
    assert!(err.to_string().to_lowercase().contains("not found"));
}
