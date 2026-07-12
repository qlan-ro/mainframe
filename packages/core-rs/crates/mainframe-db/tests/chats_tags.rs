//! Ported from `packages/core/src/db/__tests__/chats-tags.test.ts`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::rc::Rc;

use rusqlite::Connection;

use mainframe_db::schema::initialize_schema;
use mainframe_db::{
    ChatListFilters, ChatTagsRepository, ChatsRepository, ProjectsRepository, TagsRepository,
};

struct Setup {
    projects: ProjectsRepository,
    tags: TagsRepository,
    chat_tags: ChatTagsRepository,
    chats: ChatsRepository,
}

fn setup() -> Setup {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&conn).unwrap();
    let conn = Rc::new(conn);
    let projects = ProjectsRepository::new(Rc::clone(&conn));
    let tags = TagsRepository::new(Rc::clone(&conn));
    let chat_tags = ChatTagsRepository::new(Rc::clone(&conn));
    let chats = ChatsRepository::new(Rc::clone(&conn), Some(chat_tags.clone()));
    Setup {
        projects,
        tags,
        chat_tags,
        chats,
    }
}

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[test]
fn list_populates_chat_tags_from_chat_tags() {
    let s = setup();
    let p = s.projects.create("/tmp/p", None).unwrap();
    let chat = s.chats.create(&p.id, "claude", None, None).unwrap();
    s.chat_tags
        .set_for_chat(&chat.id, &v(&["feature", "ui"]), &s.tags)
        .unwrap();
    let result = s.chats.list(&p.id).unwrap();
    assert_eq!(result.len(), 1);
    let mut tags = result[0].tags.clone().unwrap();
    tags.sort();
    assert_eq!(tags, v(&["feature", "ui"]));
}

#[test]
fn list_returns_empty_tags_array_for_chats_with_no_tags() {
    let s = setup();
    let p = s.projects.create("/tmp/p", None).unwrap();
    s.chats.create(&p.id, "claude", None, None).unwrap();
    let result = s.chats.list(&p.id).unwrap();
    assert_eq!(result[0].tags, Some(vec![]));
}

#[test]
fn list_does_not_run_extra_queries_when_chat_tags_is_omitted() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&conn).unwrap();
    let conn = Rc::new(conn);
    let projects = ProjectsRepository::new(Rc::clone(&conn));
    let chats_no_tags = ChatsRepository::new(Rc::clone(&conn), None);
    let p = projects.create("/tmp/p", None).unwrap();
    chats_no_tags.create(&p.id, "claude", None, None).unwrap();
    let result = chats_no_tags.list(&p.id).unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].tags, None);
}

#[test]
fn get_populates_chat_tags_for_a_single_chat() {
    let s = setup();
    let p = s.projects.create("/tmp/p", None).unwrap();
    let chat = s.chats.create(&p.id, "claude", None, None).unwrap();
    s.chat_tags
        .set_for_chat(&chat.id, &v(&["backend"]), &s.tags)
        .unwrap();
    let result = s.chats.get(&chat.id).unwrap();
    assert!(result.is_some());
    assert_eq!(result.unwrap().tags, Some(v(&["backend"])));
}

#[test]
fn get_returns_empty_tags_array_for_a_chat_with_no_tags() {
    let s = setup();
    let p = s.projects.create("/tmp/p", None).unwrap();
    let chat = s.chats.create(&p.id, "claude", None, None).unwrap();
    let result = s.chats.get(&chat.id).unwrap();
    assert_eq!(result.unwrap().tags, Some(vec![]));
}

#[test]
fn list_filtered_throws_when_tags_all_given_but_chat_tags_is_absent() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&conn).unwrap();
    let chats = ChatsRepository::new(Rc::new(conn), None); // no chatTags
    let err = chats
        .list_filtered(&ChatListFilters {
            tags_all: Some(v(&["feature"])),
            ..Default::default()
        })
        .unwrap_err();
    assert!(err.to_string().contains("ChatTagsRepository"));
}

#[test]
fn list_filtered_includes_archived_chats_when_include_archived_is_true() {
    let s = setup();
    let p = s.projects.create("/tmp/p", None).unwrap();
    let active = s.chats.create(&p.id, "claude", None, None).unwrap();
    let archived = s.chats.create(&p.id, "claude", None, None).unwrap();
    s.chats
        .update(
            &archived.id,
            &mainframe_db::ChatUpdate {
                status: Some(mainframe_types::chat::ChatStatus::Archived),
                ..Default::default()
            },
        )
        .unwrap();

    let default_list = s
        .chats
        .list_filtered(&ChatListFilters {
            project_id: Some(p.id.clone()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(
        default_list
            .iter()
            .map(|c| c.id.clone())
            .collect::<Vec<_>>(),
        vec![active.id.clone()]
    );

    let all_list = s
        .chats
        .list_filtered(&ChatListFilters {
            project_id: Some(p.id.clone()),
            include_archived: true,
            ..Default::default()
        })
        .unwrap();
    let mut ids: Vec<String> = all_list.iter().map(|c| c.id.clone()).collect();
    ids.sort();
    let mut expected = vec![active.id, archived.id];
    expected.sort();
    assert_eq!(ids, expected);
}
