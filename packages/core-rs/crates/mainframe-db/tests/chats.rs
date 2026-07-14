//! Ported from `packages/core/src/db/__tests__/chats.test.ts`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::rc::Rc;

use rusqlite::Connection;

use mainframe_db::schema::initialize_schema;
use mainframe_db::{ChatListFilters, ChatUpdate, ChatsRepository, ProjectsRepository};
use mainframe_types::chat::{ChatStatus, TodoItem, TodoStatus};

fn setup() -> (ChatsRepository, ProjectsRepository) {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    let conn = Rc::new(conn);
    let chats = ChatsRepository::new(Rc::clone(&conn), None);
    let projects = ProjectsRepository::new(Rc::clone(&conn));
    (chats, projects)
}

fn todo(content: &str, status: TodoStatus, active_form: &str) -> TodoItem {
    TodoItem {
        content: content.to_string(),
        status,
        active_form: active_form.to_string(),
    }
}

#[test]
fn returns_null_when_no_todos_have_been_set() {
    let (chats, projects) = setup();
    let p = projects.create("/project/todos", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
    assert!(chats.get_todos(&chat.id).unwrap().is_none());
}

#[test]
fn stores_and_retrieves_todos() {
    let (chats, projects) = setup();
    let p = projects.create("/project/todos", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
    let todos = vec![
        todo("Write tests", TodoStatus::Completed, "Writing tests"),
        todo(
            "Implement feature",
            TodoStatus::InProgress,
            "Implementing feature",
        ),
        todo("Review code", TodoStatus::Pending, "Reviewing code"),
    ];
    chats.update_todos(&chat.id, &todos).unwrap();
    assert_eq!(chats.get_todos(&chat.id).unwrap(), Some(todos));
}

#[test]
fn replaces_todos_on_subsequent_calls() {
    let (chats, projects) = setup();
    let p = projects.create("/project/todos", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
    chats
        .update_todos(
            &chat.id,
            &[todo("Old task", TodoStatus::Pending, "Old task")],
        )
        .unwrap();
    let new_todos = vec![todo("New task", TodoStatus::InProgress, "New task")];
    chats.update_todos(&chat.id, &new_todos).unwrap();
    assert_eq!(chats.get_todos(&chat.id).unwrap(), Some(new_todos));
}

#[test]
fn includes_todos_in_get_result() {
    let (chats, projects) = setup();
    let p = projects.create("/project/todos", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
    let todos = vec![todo("Task 1", TodoStatus::Pending, "Task 1")];
    chats.update_todos(&chat.id, &todos).unwrap();
    let loaded = chats.get(&chat.id).unwrap();
    assert_eq!(loaded.unwrap().todos, Some(todos));
}

#[test]
fn includes_todos_in_list_results() {
    let (chats, projects) = setup();
    let p = projects.create("/project/todos", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
    let todos = vec![todo("Task 1", TodoStatus::Completed, "Task 1")];
    chats.update_todos(&chat.id, &todos).unwrap();
    let all = chats.list(&p.id).unwrap();
    assert_eq!(all[0].todos, Some(todos));
}

#[test]
fn list_all_returns_chats_across_all_projects_sorted_by_updated_at_desc() {
    let (chats, projects) = setup();
    let p1 = projects.create("/project/one", None).unwrap();
    let p2 = projects.create("/project/two", None).unwrap();

    let chat1 = chats.create(&p1.id, "claude", None, None, None).unwrap();
    let chat2 = chats.create(&p2.id, "claude", None, None, None).unwrap();
    let chat3 = chats.create(&p1.id, "claude", None, None, None).unwrap();

    let all = chats.list_all().unwrap();
    assert_eq!(all.len(), 3);
    // Most recent first (rowid DESC tiebreak on equal timestamps).
    assert_eq!(all[0].id, chat3.id);
    assert_eq!(all[1].id, chat2.id);
    assert_eq!(all[2].id, chat1.id);
}

#[test]
fn list_all_includes_archived_chats() {
    let (chats, projects) = setup();
    let p1 = projects.create("/project/one", None).unwrap();
    let chat1 = chats.create(&p1.id, "claude", None, None, None).unwrap();
    chats
        .update(
            &chat1.id,
            &ChatUpdate {
                status: Some(ChatStatus::Archived),
                ..Default::default()
            },
        )
        .unwrap();

    chats.create(&p1.id, "claude", None, None, None).unwrap();

    let all = chats.list_all().unwrap();
    assert_eq!(all.len(), 2);
    assert!(all.iter().any(|c| c.status == ChatStatus::Archived));
}

#[test]
fn persists_automation_run_id_and_round_trips_through_get() {
    let (chats, projects) = setup();
    let p = projects.create("/project/automations", None).unwrap();
    let created = chats
        .create(&p.id, "claude", None, None, Some("run-42"))
        .unwrap();
    assert_eq!(created.automation_run_id.as_deref(), Some("run-42"));

    let fetched = chats.get(&created.id).unwrap().unwrap();
    assert_eq!(fetched.automation_run_id.as_deref(), Some("run-42"));
}

#[test]
fn leaves_automation_run_id_none_for_a_normal_chat() {
    let (chats, projects) = setup();
    let p = projects.create("/project/manual", None).unwrap();
    let created = chats.create(&p.id, "claude", None, None, None).unwrap();
    assert_eq!(created.automation_run_id, None);

    let fetched = chats.get(&created.id).unwrap().unwrap();
    assert_eq!(fetched.automation_run_id, None);
}

#[test]
fn list_filtered_excludes_chats_with_an_automation_run_id() {
    let (chats, projects) = setup();
    let p = projects.create("/project/filtered", None).unwrap();
    let manual = chats.create(&p.id, "claude", None, None, None).unwrap();
    let automated = chats
        .create(&p.id, "claude", None, None, Some("run-1"))
        .unwrap();

    let ids: Vec<String> = chats
        .list_filtered(&ChatListFilters::default())
        .unwrap()
        .into_iter()
        .map(|c| c.id)
        .collect();

    assert!(ids.contains(&manual.id));
    assert!(!ids.contains(&automated.id));
}
