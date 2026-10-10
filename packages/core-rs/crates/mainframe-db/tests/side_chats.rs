//! `ChatsRepository::find_or_create_side_chat` and the `sideChatId` projection.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::rc::Rc;

use rusqlite::Connection;

use mainframe_db::schema::initialize_schema;
use mainframe_db::{ChatListFilters, ChatUpdate, ChatsRepository, ProjectsRepository};
use mainframe_types::chat::NewChat;
use mainframe_types::settings::ExecutionMode;

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

#[test]
fn find_or_create_side_chat_returns_the_same_row_on_the_second_call() {
    let (chats, projects, _conn) = setup();
    let p = projects.create("/project/side-chats", None).unwrap();
    let parent = chats.create(&new_chat(&p.id)).unwrap();

    let (first, created_first) = chats.find_or_create_side_chat(&parent).unwrap();
    assert!(created_first);
    assert!(first.temporary);
    assert_eq!(first.parent_chat_id, Some(Some(parent.id.clone())));

    let (second, created_second) = chats.find_or_create_side_chat(&parent).unwrap();
    assert!(!created_second);
    assert_eq!(second.id, first.id);
}

#[test]
fn find_or_create_side_chat_seeds_the_parent_fields_and_nothing_else() {
    let (chats, projects, _conn) = setup();
    let p = projects.create("/project/side-chats-seed", None).unwrap();
    let mut parent = chats.create(&new_chat(&p.id)).unwrap();
    chats
        .update(
            &parent.id,
            &ChatUpdate {
                model: Some("claude-opus".to_string()),
                permission_mode: Some(ExecutionMode::AcceptEdits),
                worktree_path: Some(Some("/tmp/wt".to_string())),
                branch_name: Some(Some("feature/x".to_string())),
                plan_mode: Some(true),
                title: Some("Parent title".to_string()),
                pinned: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    parent = chats.get(&parent.id).unwrap().unwrap();

    let (side, created) = chats.find_or_create_side_chat(&parent).unwrap();
    assert!(created);
    assert_eq!(side.project_id, parent.project_id);
    assert_eq!(side.adapter_id, parent.adapter_id);
    assert_eq!(side.model, parent.model);
    assert_eq!(side.permission_mode, parent.permission_mode);
    assert_eq!(side.plan_mode, Some(true));
    assert_eq!(side.worktree_path, parent.worktree_path);
    assert_eq!(side.branch_name, parent.branch_name);
    assert_eq!(side.scratch_path, parent.scratch_path);
    assert_eq!(side.parent_chat_id, Some(Some(parent.id.clone())));
    assert!(side.temporary);

    // No title, no pin, no tags, zero counters.
    assert_eq!(side.title, None);
    assert_eq!(side.pinned, Some(false));
    assert_eq!(side.total_cost, 0.0);
    assert_eq!(side.total_tokens_input, 0);
    assert_eq!(side.total_tokens_output, 0);
}

#[test]
fn side_chat_id_appears_on_the_parent_through_get_list_and_list_filtered() {
    let (chats, projects, _conn) = setup();
    let p = projects
        .create("/project/side-chats-visibility", None)
        .unwrap();
    let parent = chats.create(&new_chat(&p.id)).unwrap();
    assert_eq!(parent.side_chat_id, None);

    let (side, _created) = chats.find_or_create_side_chat(&parent).unwrap();

    let via_get = chats.get(&parent.id).unwrap().unwrap();
    assert_eq!(via_get.side_chat_id, Some(side.id.clone()));

    let via_list = chats.list(&p.id).unwrap();
    let parent_row = via_list.iter().find(|c| c.id == parent.id).unwrap();
    assert_eq!(parent_row.side_chat_id, Some(side.id.clone()));

    let via_list_filtered = chats
        .list_filtered(&ChatListFilters {
            project_id: Some(p.id.clone()),
            include_temporary: true,
            ..Default::default()
        })
        .unwrap();
    let parent_row = via_list_filtered
        .iter()
        .find(|c| c.id == parent.id)
        .unwrap();
    assert_eq!(parent_row.side_chat_id, Some(side.id.clone()));

    // The side chat itself has no side chat.
    assert_eq!(side.side_chat_id, None);
}

#[test]
fn list_filtered_excludes_side_chats_with_and_without_include_temporary() {
    let (chats, projects, _conn) = setup();
    let p = projects
        .create("/project/side-chats-listing", None)
        .unwrap();
    let parent = chats.create(&new_chat(&p.id)).unwrap();
    let (side, _created) = chats.find_or_create_side_chat(&parent).unwrap();

    let default_list = chats
        .list_filtered(&ChatListFilters {
            project_id: Some(p.id.clone()),
            ..Default::default()
        })
        .unwrap();
    assert!(!default_list.iter().any(|c| c.id == side.id));
    assert!(default_list.iter().any(|c| c.id == parent.id));

    let with_temporary = chats
        .list_filtered(&ChatListFilters {
            project_id: Some(p.id.clone()),
            include_temporary: true,
            ..Default::default()
        })
        .unwrap();
    assert!(!with_temporary.iter().any(|c| c.id == side.id));
    assert!(with_temporary.iter().any(|c| c.id == parent.id));
}

#[test]
fn a_second_side_chat_insert_fails_under_the_unique_index() {
    let (chats, projects, conn) = setup();
    let p = projects.create("/project/side-chats-unique", None).unwrap();
    let parent = chats.create(&new_chat(&p.id)).unwrap();
    chats.find_or_create_side_chat(&parent).unwrap();

    // Bypass find_or_create's own dedup check to prove the DB-level invariant:
    // a second temporary row with the same parent_chat_id must be rejected by
    // the partial unique index from migration 30.
    let result = conn.execute(
        "INSERT INTO chats (id, adapter_id, project_id, parent_chat_id, temporary, status, created_at, updated_at) \
         VALUES ('side-2', 'claude', ?, ?, 1, 'active', 'now', 'now')",
        rusqlite::params![p.id, parent.id],
    );
    assert!(result.is_err());
}
