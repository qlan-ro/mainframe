//! Migration 32 and the agent-provenance queries.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::rc::Rc;

use rusqlite::Connection;

use mainframe_db::migrations::{LATEST_VERSION, run_migrations};
use mainframe_db::schema::initialize_schema;
use mainframe_db::{ChatsRepository, ProjectsRepository};
use mainframe_types::chat::NewChat;

fn setup() -> (ChatsRepository, ProjectsRepository, Rc<Connection>) {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&conn).unwrap();
    let conn = Rc::new(conn);
    (
        ChatsRepository::new(Rc::clone(&conn), None),
        ProjectsRepository::new(Rc::clone(&conn)),
        conn,
    )
}

fn new_chat(project_id: &str) -> NewChat {
    NewChat {
        project_id: project_id.to_string(),
        adapter_id: "claude".to_string(),
        ..Default::default()
    }
}

fn has_table(db: &Connection, name: &str) -> bool {
    db.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
        [name],
        |row| row.get::<_, i64>(0),
    )
    .unwrap()
        == 1
}

#[test]
fn a_v30_db_upgrades_to_32_keeping_its_rows() {
    let db = Connection::open_in_memory().unwrap();
    run_migrations(&db, 30).unwrap();
    let now = "2026-01-01T00:00:00.000Z";
    db.execute(
        "INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES ('p', 'p', '/p', ?, ?)",
        [now, now],
    )
    .unwrap();
    db.execute(
        "INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) \
         VALUES ('c', 'claude', 'p', 'active', ?, ?)",
        [now, now],
    )
    .unwrap();

    run_migrations(&db, LATEST_VERSION).unwrap();

    assert!(has_table(&db, "delegated_tasks"));
    let creator: Option<String> = db
        .query_row(
            "SELECT created_by_chat_id FROM chats WHERE id = 'c'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(creator, None);
}

#[test]
fn the_request_index_is_unique_per_parent_only_when_a_key_is_set() {
    let (_, _, conn) = setup();
    let insert = |id: &str, child: &str, key: Option<&str>| {
        conn.execute(
            "INSERT INTO delegated_tasks (id, parent_chat_id, child_chat_id, client_request_id, \
             status, depth, created_at, updated_at) VALUES (?, 'parent', ?, ?, 'running', 1, '', '')",
            rusqlite::params![id, child, key],
        )
    };
    insert("t1", "c1", Some("k")).unwrap();
    assert!(insert("t2", "c2", Some("k")).is_err());
    insert("t3", "c3", None).unwrap();
    insert("t4", "c4", None).unwrap();
}

#[test]
fn agent_lineage_is_recorded_and_read_back_per_project() {
    let (chats, projects, _conn) = setup();
    let p = projects.create("/project/orchestration", None).unwrap();
    let caller = chats.create(&new_chat(&p.id)).unwrap();
    let launched = chats.create(&new_chat(&p.id)).unwrap();
    let child = chats.create(&new_chat(&p.id)).unwrap();

    chats
        .set_agent_lineage(&launched.id, &caller.id, None)
        .unwrap();
    chats
        .set_agent_lineage(&child.id, &caller.id, Some(&caller.id))
        .unwrap();

    assert_eq!(
        chats.created_by(&launched.id).unwrap(),
        Some(caller.id.clone())
    );
    assert_eq!(chats.created_by(&caller.id).unwrap(), None);
    let map = chats.created_by_in_project(&p.id).unwrap();
    assert_eq!(map.len(), 2);
    let child_row = chats.get(&child.id).unwrap().unwrap();
    assert_eq!(child_row.parent_chat_id, Some(Some(caller.id.clone())));
    let launched_row = chats.get(&launched.id).unwrap().unwrap();
    assert_eq!(launched_row.parent_chat_id.flatten(), None);
}
