//! Ported from `packages/core/src/db/__tests__/projects.test.ts`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::rc::Rc;

use rusqlite::Connection;

use mainframe_db::schema::initialize_schema;
use mainframe_db::{ChatTagsRepository, ChatsRepository, ProjectsRepository};

fn mem() -> Rc<Connection> {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    Rc::new(conn)
}

#[test]
fn returns_parent_project_id_as_null_for_regular_projects() {
    let repo = ProjectsRepository::new(mem());
    let project = repo.create("/path/to/repo", None).unwrap();
    assert_eq!(project.parent_project_id, Some(None));

    let fetched = repo.get(&project.id).unwrap();
    assert_eq!(fetched.unwrap().parent_project_id, Some(None));
}

#[test]
fn returns_parent_project_id_in_list() {
    let repo = ProjectsRepository::new(mem());
    repo.create("/path/to/repo", None).unwrap();
    let projects = repo.list().unwrap();
    assert_eq!(projects[0].parent_project_id, Some(None));
}

#[test]
fn returns_parent_project_id_in_get_by_path() {
    let repo = ProjectsRepository::new(mem());
    repo.create("/path/to/repo", None).unwrap();
    let project = repo.get_by_path("/path/to/repo").unwrap();
    assert_eq!(project.unwrap().parent_project_id, Some(None));
}

#[test]
fn sets_parent_project_id_on_a_project() {
    let repo = ProjectsRepository::new(mem());
    let parent = repo.create("/main/repo", None).unwrap();
    let worktree = repo.create("/main/repo/.worktrees/feat", None).unwrap();

    repo.set_parent_project(&worktree.id, &parent.id).unwrap();

    let fetched = repo.get(&worktree.id).unwrap().unwrap();
    assert_eq!(fetched.parent_project_id, Some(Some(parent.id)));
}

#[test]
fn clears_parent_project_id_when_clear_parent_project_is_called() {
    let repo = ProjectsRepository::new(mem());
    let parent = repo.create("/main/repo", None).unwrap();
    let worktree = repo.create("/main/repo/.worktrees/feat", None).unwrap();

    repo.set_parent_project(&worktree.id, &parent.id).unwrap();
    repo.clear_parent_project(&parent.id).unwrap();

    let fetched = repo.get(&worktree.id).unwrap().unwrap();
    assert_eq!(fetched.parent_project_id, Some(None));
}

#[test]
fn deleting_a_project_also_deletes_its_chats() {
    let conn = mem();
    let repo = ProjectsRepository::new(Rc::clone(&conn));
    let chat_tags = ChatTagsRepository::new(Rc::clone(&conn));
    let chats = ChatsRepository::new(Rc::clone(&conn), Some(chat_tags));

    let project = repo.create("/some/path", None).unwrap();
    chats.create(&project.id, "claude", None, None).unwrap();
    chats.create(&project.id, "claude", None, None).unwrap();

    repo.remove(&project.id).unwrap();

    assert!(repo.get(&project.id).unwrap().is_none());
    assert_eq!(chats.list(&project.id).unwrap().len(), 0);
}

#[test]
fn deleting_a_parent_project_nulls_children_parent_project_id() {
    let conn = mem();
    let repo = ProjectsRepository::new(Rc::clone(&conn));

    let parent = repo.create("/main/repo", None).unwrap();
    let child = repo.create("/main/repo/.worktrees/feat", None).unwrap();
    repo.set_parent_project(&child.id, &parent.id).unwrap();

    repo.remove(&parent.id).unwrap();

    // parent is gone
    assert!(repo.get(&parent.id).unwrap().is_none());
    // child survives with nulled FK
    let fetched = repo.get(&child.id).unwrap();
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().parent_project_id, Some(None));
}

#[test]
fn delete_is_atomic() {
    let conn = mem();
    let repo = ProjectsRepository::new(Rc::clone(&conn));
    let chat_tags = ChatTagsRepository::new(Rc::clone(&conn));
    let chats = ChatsRepository::new(Rc::clone(&conn), Some(chat_tags));

    let project = repo.create("/atomic/path", None).unwrap();
    chats.create(&project.id, "claude", None, None).unwrap();

    repo.remove(&project.id).unwrap();

    assert!(repo.get(&project.id).unwrap().is_none());
    assert_eq!(chats.list(&project.id).unwrap().len(), 0);
}
