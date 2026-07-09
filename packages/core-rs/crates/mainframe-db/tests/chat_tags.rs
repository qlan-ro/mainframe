//! Ported from `packages/core/src/db/__tests__/chat-tags.test.ts`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::rc::Rc;

use rusqlite::Connection;

use mainframe_db::schema::initialize_schema;
use mainframe_db::{ChatTagsRepository, TagsRepository};

const NOW: &str = "2026-01-01T00:00:00.000Z";

struct Setup {
    tags: TagsRepository,
    chat_tags: ChatTagsRepository,
}

fn setup() -> Setup {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&conn).unwrap();
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)",
        rusqlite::params!["p1", "p", "/tmp/p", NOW, NOW],
    )
    .unwrap();
    for id in ["c1", "c2", "c3"] {
        conn.execute(
            "INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            rusqlite::params![id, "claude", "p1", "active", NOW, NOW],
        )
        .unwrap();
    }
    let conn = Rc::new(conn);
    Setup {
        tags: TagsRepository::new(Rc::clone(&conn)),
        chat_tags: ChatTagsRepository::new(Rc::clone(&conn)),
    }
}

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[test]
fn list_for_chat_returns_empty_initially() {
    assert_eq!(
        setup().chat_tags.list_for_chat("c1").unwrap(),
        Vec::<String>::new()
    );
}

#[test]
fn set_for_chat_replaces_user_tags_atomically() {
    let s = setup();
    s.chat_tags
        .set_for_chat("c1", &v(&["feature", "ui"]), &s.tags)
        .unwrap();
    let mut got = s.chat_tags.list_for_chat("c1").unwrap();
    got.sort();
    assert_eq!(got, v(&["feature", "ui"]));
    s.chat_tags
        .set_for_chat("c1", &v(&["bug"]), &s.tags)
        .unwrap();
    assert_eq!(s.chat_tags.list_for_chat("c1").unwrap(), v(&["bug"]));
}

#[test]
fn set_for_chat_auto_creates_missing_tags() {
    let s = setup();
    s.chat_tags
        .set_for_chat("c1", &v(&["mobile"]), &s.tags)
        .unwrap();
    assert!(s.tags.get("mobile").unwrap().is_some());
}

#[test]
fn list_in_use_returns_distinct_tags_currently_associated() {
    let s = setup();
    s.chat_tags
        .set_for_chat("c1", &v(&["feature"]), &s.tags)
        .unwrap();
    s.chat_tags
        .set_for_chat("c2", &v(&["feature", "bug"]), &s.tags)
        .unwrap();
    let mut got = s.chat_tags.list_in_use(None).unwrap();
    got.sort();
    assert_eq!(got, v(&["bug", "feature"]));
}

#[test]
fn list_in_use_with_project_id_filters() {
    let s = setup();
    s.chat_tags
        .set_for_chat("c1", &v(&["feature"]), &s.tags)
        .unwrap();
    let mut got = s.chat_tags.list_in_use(Some("p1")).unwrap();
    got.sort();
    assert_eq!(got, v(&["feature"]));
    assert_eq!(
        s.chat_tags.list_in_use(Some("p-other")).unwrap(),
        Vec::<String>::new()
    );
}

#[test]
fn filter_chat_ids_and_intersects_user_tags() {
    let s = setup();
    s.chat_tags
        .set_for_chat("c1", &v(&["feature", "ui"]), &s.tags)
        .unwrap();
    s.chat_tags
        .set_for_chat("c2", &v(&["feature"]), &s.tags)
        .unwrap();
    s.chat_tags
        .set_for_chat("c3", &v(&["bug"]), &s.tags)
        .unwrap();
    let mut got = s
        .chat_tags
        .filter_chat_ids(&v(&["feature", "ui"]))
        .unwrap()
        .unwrap();
    got.sort();
    assert_eq!(got, v(&["c1"]));
    let mut got = s
        .chat_tags
        .filter_chat_ids(&v(&["feature"]))
        .unwrap()
        .unwrap();
    got.sort();
    assert_eq!(got, v(&["c1", "c2"]));
    assert_eq!(s.chat_tags.filter_chat_ids(&[]).unwrap(), None);
}

#[test]
fn bulk_for_chats_returns_a_map_of_chat_id_to_tags() {
    let s = setup();
    s.chat_tags
        .set_for_chat("c1", &v(&["feature", "ui"]), &s.tags)
        .unwrap();
    s.chat_tags
        .set_for_chat("c2", &v(&["bug"]), &s.tags)
        .unwrap();
    let map = s.chat_tags.bulk_for_chats(&v(&["c1", "c2", "c3"])).unwrap();
    let mut c1 = map.get("c1").cloned().unwrap();
    c1.sort();
    assert_eq!(c1, v(&["feature", "ui"]));
    assert_eq!(map.get("c2").cloned(), Some(v(&["bug"])));
    assert!(!map.contains_key("c3")); // c3 has no tags
}

#[test]
fn bulk_for_chats_with_empty_input_returns_empty_map() {
    let s = setup();
    assert_eq!(s.chat_tags.bulk_for_chats(&[]).unwrap().len(), 0);
}

#[test]
fn cascades_on_chat_deletion() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&conn).unwrap();
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)",
        rusqlite::params!["p1", "p", "/tmp/p", NOW, NOW],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        rusqlite::params!["c1", "claude", "p1", "active", NOW, NOW],
    )
    .unwrap();
    let conn = Rc::new(conn);
    let tags = TagsRepository::new(Rc::clone(&conn));
    let chat_tags = ChatTagsRepository::new(Rc::clone(&conn));
    chat_tags
        .set_for_chat("c1", &v(&["feature"]), &tags)
        .unwrap();
    assert_eq!(chat_tags.list_for_chat("c1").unwrap(), v(&["feature"]));
    conn.execute("DELETE FROM chats WHERE id = ?", ["c1"])
        .unwrap();
    assert_eq!(chat_tags.list_for_chat("c1").unwrap(), Vec::<String>::new());
}

#[test]
fn set_for_chat_rolls_back_when_an_invalid_tag_name_throws() {
    let s = setup();
    s.chat_tags
        .set_for_chat("c1", &v(&["existing"]), &s.tags)
        .unwrap();
    // 'has-foo' triggers the reserved-prefix error inside registry.upsert
    let err = s
        .chat_tags
        .set_for_chat("c1", &v(&["ok-tag", "has-foo"]), &s.tags)
        .unwrap_err();
    assert!(err.to_string().to_lowercase().contains("reserved"));
    // Original associations preserved by transaction rollback.
    assert_eq!(s.chat_tags.list_for_chat("c1").unwrap(), v(&["existing"]));
}

#[test]
fn filter_chat_ids_dedupes_duplicate_input_tags() {
    let s = setup();
    s.chat_tags
        .set_for_chat("c1", &v(&["feature"]), &s.tags)
        .unwrap();
    // Duplicate input must not break HAVING COUNT
    let mut got = s
        .chat_tags
        .filter_chat_ids(&v(&["feature", "feature"]))
        .unwrap()
        .unwrap();
    got.sort();
    assert_eq!(got, v(&["c1"]));
}
