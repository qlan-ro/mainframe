//! Ported from `packages/core/src/db/__tests__/chats.test.ts`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::rc::Rc;

use rusqlite::Connection;

use mainframe_db::schema::initialize_schema;
use mainframe_db::{ChatListFilters, ChatUpdate, ChatsRepository, ProjectsRepository};
use mainframe_types::adapter::EffortLevel;
use mainframe_types::chat::{ChatStatus, TodoItem, TodoStatus};
use mainframe_types::settings::ExecutionMode;

fn setup_with_conn() -> (ChatsRepository, ProjectsRepository, Rc<Connection>) {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    let conn = Rc::new(conn);
    let chats = ChatsRepository::new(Rc::clone(&conn), None);
    let projects = ProjectsRepository::new(Rc::clone(&conn));
    (chats, projects, conn)
}

fn setup() -> (ChatsRepository, ProjectsRepository) {
    let (chats, projects, _) = setup_with_conn();
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

#[test]
fn dismissed_worktrees_start_empty_and_round_trip_in_insertion_order() {
    let (chats, projects) = setup();
    let p = projects.create("/project/dismissed", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
    assert_eq!(
        chats.get_dismissed_worktrees(&chat.id).unwrap(),
        Vec::<String>::new()
    );

    assert!(chats.add_dismissed_worktree(&chat.id, "/wt/alpha").unwrap());
    assert!(chats.add_dismissed_worktree(&chat.id, "/wt/beta").unwrap());

    assert_eq!(
        chats.get_dismissed_worktrees(&chat.id).unwrap(),
        vec!["/wt/alpha".to_string(), "/wt/beta".to_string()]
    );
}

#[test]
fn adding_an_already_dismissed_worktree_returns_false_and_does_not_grow_the_list() {
    let (chats, projects) = setup();
    let p = projects.create("/project/dismissed-dup", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
    chats.add_dismissed_worktree(&chat.id, "/wt/alpha").unwrap();

    assert!(!chats.add_dismissed_worktree(&chat.id, "/wt/alpha").unwrap());
    assert_eq!(
        chats.get_dismissed_worktrees(&chat.id).unwrap(),
        vec!["/wt/alpha".to_string()]
    );
}

#[test]
fn dismissed_worktrees_falls_back_to_empty_when_the_stored_json_is_malformed() {
    let (chats, projects, conn) = setup_with_conn();
    let p = projects.create("/project/dismissed-bad", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
    conn.execute(
        "UPDATE chats SET dismissed_worktrees = ? WHERE id = ?",
        rusqlite::params!["{not json", chat.id],
    )
    .unwrap();

    assert_eq!(
        chats.get_dismissed_worktrees(&chat.id).unwrap(),
        Vec::<String>::new()
    );
    // A malformed column must not block a later dismissal.
    assert!(chats.add_dismissed_worktree(&chat.id, "/wt/alpha").unwrap());
    assert_eq!(
        chats.get_dismissed_worktrees(&chat.id).unwrap(),
        vec!["/wt/alpha".to_string()]
    );
}

#[test]
fn dismissed_worktrees_are_scoped_per_chat() {
    let (chats, projects) = setup();
    let p = projects.create("/project/dismissed-scope", None).unwrap();
    let one = chats.create(&p.id, "claude", None, None, None).unwrap();
    let two = chats.create(&p.id, "claude", None, None, None).unwrap();
    chats.add_dismissed_worktree(&one.id, "/wt/alpha").unwrap();

    assert_eq!(
        chats.get_dismissed_worktrees(&two.id).unwrap(),
        Vec::<String>::new()
    );
}

// ── effort round-trip (todo #302) ──────────────────────────────────────────

#[test]
fn chat_effort_round_trips_ultra() {
    let (chats, projects) = setup();
    let p = projects.create("/project/effort-ultra", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
    chats
        .update(
            &chat.id,
            &ChatUpdate {
                effort: Some(Some(EffortLevel::Ultra)),
                ..Default::default()
            },
        )
        .unwrap();

    let fetched = chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(fetched.effort, Some(Some(EffortLevel::Ultra)));
}

#[test]
fn chat_effort_round_trips_for_pre_existing_levels() {
    let (chats, projects) = setup();
    let p = projects.create("/project/effort-regression", None).unwrap();
    for level in [
        EffortLevel::None,
        EffortLevel::Minimal,
        EffortLevel::Low,
        EffortLevel::Medium,
        EffortLevel::High,
        EffortLevel::Xhigh,
        EffortLevel::Max,
    ] {
        let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
        chats
            .update(
                &chat.id,
                &ChatUpdate {
                    effort: Some(Some(level)),
                    ..Default::default()
                },
            )
            .unwrap();

        let fetched = chats.get(&chat.id).unwrap().unwrap();
        assert_eq!(
            fetched.effort,
            Some(Some(level)),
            "level {level:?} did not round-trip"
        );
    }
}

#[test]
fn chat_effort_defaults_to_none_when_never_set() {
    let (chats, projects) = setup();
    let p = projects.create("/project/effort-unset", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();

    let fetched = chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(fetched.effort, None);
}

#[test]
fn chat_effort_reads_back_none_for_a_bogus_stored_value() {
    let (chats, projects, conn) = setup_with_conn();
    let p = projects.create("/project/effort-bogus", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
    conn.execute(
        "UPDATE chats SET effort = 'turbo' WHERE id = ?",
        rusqlite::params![chat.id],
    )
    .unwrap();

    let fetched = chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(fetched.effort, None);
}

#[test]
fn permission_mode_auto_survives_a_reopen() {
    let (chats, projects, conn) = setup_with_conn();
    let p = projects.create("/project/mode-auto", None).unwrap();
    let chat = chats
        .create(&p.id, "claude", None, Some("auto"), None)
        .unwrap();

    // A second repository over the same connection stands in for a daemon
    // restart re-opening the same on-disk database.
    let reopened = ChatsRepository::new(Rc::clone(&conn), None);
    let fetched = reopened.get(&chat.id).unwrap().unwrap();
    assert_eq!(fetched.permission_mode, Some(ExecutionMode::Auto));
}

#[test]
fn permission_mode_reads_back_none_for_a_bogus_stored_value() {
    let (chats, projects, conn) = setup_with_conn();
    let p = projects.create("/project/mode-bogus", None).unwrap();
    let chat = chats.create(&p.id, "claude", None, None, None).unwrap();
    conn.execute(
        "UPDATE chats SET permission_mode = 'turbo' WHERE id = ?",
        rusqlite::params![chat.id],
    )
    .unwrap();

    let fetched = chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(fetched.permission_mode, None);
}
