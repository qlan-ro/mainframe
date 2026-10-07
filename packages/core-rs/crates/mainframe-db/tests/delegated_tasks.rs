//! `DelegatedTasksRepository` (migration 32).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::rc::Rc;

use rusqlite::Connection;

use mainframe_db::schema::initialize_schema;
use mainframe_db::{ChatsRepository, DelegatedTasksRepository, ProjectsRepository};
use mainframe_types::chat::NewChat;
use mainframe_types::orchestration::{DelegatedTask, TaskDelivery, TaskRole, TaskStatus};

struct Repos {
    chats: ChatsRepository,
    projects: ProjectsRepository,
    tasks: DelegatedTasksRepository,
}

fn setup() -> Repos {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    initialize_schema(&conn).unwrap();
    let conn = Rc::new(conn);
    Repos {
        chats: ChatsRepository::new(Rc::clone(&conn), None),
        projects: ProjectsRepository::new(Rc::clone(&conn)),
        tasks: DelegatedTasksRepository::new(conn),
    }
}

fn task(id: &str, parent: &str, child: &str, created_at: &str) -> DelegatedTask {
    DelegatedTask {
        id: id.into(),
        parent_chat_id: parent.into(),
        child_chat_id: child.into(),
        client_request_id: None,
        title: Some("Review".into()),
        role: TaskRole::Review,
        status: TaskStatus::Running,
        depth: 1,
        summary: None,
        error: None,
        cancel_reason: None,
        delivery: TaskDelivery::Pending,
        created_at: created_at.into(),
        updated_at: created_at.into(),
        completed_at: None,
    }
}

#[test]
fn insert_get_update_round_trip() {
    let repos = setup();
    let mut row = task("t1", "p", "c1", "1");
    row.client_request_id = Some("key".into());
    repos.tasks.insert(&row).unwrap();
    assert_eq!(repos.tasks.get("t1").unwrap(), Some(row.clone()));
    assert_eq!(repos.tasks.get_by_child("c1").unwrap(), Some(row.clone()));
    assert_eq!(
        repos.tasks.find_by_request("p", "key").unwrap(),
        Some(row.clone())
    );
    assert_eq!(repos.tasks.find_by_request("other", "key").unwrap(), None);

    row.status = TaskStatus::Completed;
    row.summary = Some("done".into());
    row.delivery = TaskDelivery::Owed;
    row.completed_at = Some("2".into());
    repos.tasks.update(&row).unwrap();
    assert_eq!(repos.tasks.get("t1").unwrap(), Some(row));
    assert_eq!(repos.tasks.list_owed().unwrap().len(), 1);
    assert!(repos.tasks.list_nonterminal().unwrap().is_empty());
}

#[test]
fn list_by_parent_is_newest_first_and_bounded() {
    let repos = setup();
    for (i, at) in ["1", "3", "2"].iter().enumerate() {
        repos
            .tasks
            .insert(&task(&format!("t{i}"), "p", &format!("c{i}"), at))
            .unwrap();
    }
    let ids: Vec<String> = repos
        .tasks
        .list_by_parent("p", 2)
        .unwrap()
        .into_iter()
        .map(|t| t.id)
        .collect();
    assert_eq!(ids, vec!["t1", "t2"]);
}

#[test]
fn boot_interrupts_unfinished_tasks_and_drops_their_delivery() {
    let repos = setup();
    repos.tasks.insert(&task("live", "p", "c1", "1")).unwrap();
    let mut done = task("done", "p", "c2", "1");
    done.status = TaskStatus::Completed;
    done.delivery = TaskDelivery::Owed;
    repos.tasks.insert(&done).unwrap();

    assert_eq!(repos.tasks.interrupt_unfinished("9").unwrap(), 1);
    let live = repos.tasks.get("live").unwrap().unwrap();
    assert_eq!(live.status, TaskStatus::Interrupted);
    assert_eq!(live.delivery, TaskDelivery::Dropped);
    assert_eq!(live.completed_at.as_deref(), Some("9"));
    let done = repos.tasks.get("done").unwrap().unwrap();
    assert_eq!(done.delivery, TaskDelivery::Owed);
}

#[test]
fn fork_side_and_delegated_children_coexist_under_one_parent() {
    let repos = setup();
    let project = repos.projects.create("/project/lineage", None).unwrap();
    let new_chat = |temporary| NewChat {
        project_id: project.id.clone(),
        adapter_id: "claude".into(),
        temporary,
        ..Default::default()
    };
    let parent = repos.chats.create(&new_chat(false)).unwrap();
    let (side, _) = repos.chats.find_or_create_side_chat(&parent).unwrap();
    let first = repos.chats.create(&new_chat(false)).unwrap();
    let second = repos.chats.create(&new_chat(false)).unwrap();
    for child in [&first, &second] {
        repos
            .chats
            .set_agent_lineage(&child.id, &parent.id, Some(&parent.id))
            .unwrap();
    }
    repos
        .tasks
        .insert(&task("t1", &parent.id, &first.id, "1"))
        .unwrap();
    repos
        .tasks
        .insert(&task("t2", &parent.id, &second.id, "2"))
        .unwrap();

    let mut done = task("t2", &parent.id, &second.id, "2");
    done.status = TaskStatus::Completed;
    repos.tasks.update(&done).unwrap();

    let first_row = repos.chats.get(&first.id).unwrap().unwrap();
    let delegation = first_row.orchestration.delegation.unwrap();
    assert_eq!(delegation.task_id, "t1");
    assert_eq!(delegation.role, TaskRole::Review);
    assert_eq!(delegation.status, TaskStatus::Running);
    assert_eq!(
        first_row.orchestration.created_by_chat_id.as_deref(),
        Some(parent.id.as_str())
    );
    let second_row = repos.chats.get(&second.id).unwrap().unwrap();
    assert_eq!(
        second_row.orchestration.delegation.map(|d| d.status),
        Some(TaskStatus::Completed)
    );
    // Only unfinished tasks count toward the parent's waiting derivation.
    let parent_row = repos.chats.get(&parent.id).unwrap().unwrap();
    assert_eq!(
        parent_row.orchestration.active_child_ids,
        vec![first.id.clone()]
    );
    assert!(parent_row.orchestration.delegation.is_none());
    let side_row = repos.chats.get(&side.id).unwrap().unwrap();
    assert!(side_row.orchestration.delegation.is_none());
    assert!(side.temporary);
}

#[test]
fn a_parent_reads_every_open_descendant_but_not_past_a_finished_task() {
    let repos = setup();
    let project = repos.projects.create("/project/tree", None).unwrap();
    let chat = || {
        repos
            .chats
            .create(&NewChat {
                project_id: project.id.clone(),
                adapter_id: "claude".into(),
                ..Default::default()
            })
            .unwrap()
    };
    let (root, child, grandchild, done, under_done) = (chat(), chat(), chat(), chat(), chat());
    let edges = [
        ("t1", &root, &child),
        ("t2", &child, &grandchild),
        ("t3", &root, &done),
        ("t4", &done, &under_done),
    ];
    for (id, parent, kid) in edges {
        repos
            .tasks
            .insert(&task(id, &parent.id, &kid.id, id))
            .unwrap();
    }
    let mut finished = task("t3", &root.id, &done.id, "t3");
    finished.status = TaskStatus::Completed;
    repos.tasks.update(&finished).unwrap();

    // A task chat has no sidebar row, so its gate must reach the top-level
    // chat that lists it: the walk spans grandchildren, and a finished task
    // ends its branch.
    let mut ids = repos
        .chats
        .get(&root.id)
        .unwrap()
        .unwrap()
        .orchestration
        .active_child_ids;
    ids.sort();
    let mut expected = vec![child.id.clone(), grandchild.id.clone()];
    expected.sort();
    assert_eq!(ids, expected);
    let child_row = repos.chats.get(&child.id).unwrap().unwrap();
    assert_eq!(
        child_row.orchestration.active_child_ids,
        vec![grandchild.id]
    );
}
