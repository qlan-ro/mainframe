//! `ChatsRepository::create_fork` and the `parent_chat_id` / `pending_fork`
//! storage seams (todo #343, Group 1 — fork-contract).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rusqlite::Connection;

use mainframe_db::schema::initialize_schema;
use mainframe_db::{
    ChatListFilters, ChatUpdate, ChatsRepository, ForkInsert, PendingFork, ProjectsRepository,
};
use mainframe_types::adapter::{EffortLevel, ForkSource};
use mainframe_types::chat::{ChatStatus, NewChat};
use mainframe_types::settings::ExecutionMode;

fn new_chat(project_id: &str) -> NewChat {
    NewChat {
        project_id: project_id.to_string(),
        adapter_id: "claude".to_string(),
        ..Default::default()
    }
}
fn setup() -> (ChatsRepository, ProjectsRepository) {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    let conn = std::rc::Rc::new(conn);
    (
        ChatsRepository::new(std::rc::Rc::clone(&conn), None),
        ProjectsRepository::new(conn),
    )
}

fn pending_fork(source_session_id: &str) -> PendingFork {
    PendingFork {
        fork_source: ForkSource {
            source_session_id: source_session_id.to_string(),
            resume_path: Some(format!("/tmp/fork-snapshots/n1/{source_session_id}.jsonl")),
        },
        snapshot_dir: "/tmp/fork-snapshots/n1".to_string(),
        provisional_title: "Untitled (fork)".to_string(),
    }
}

#[test]
fn create_fork_round_trips_every_inherited_field_and_parent_chat_id() {
    let (chats, projects) = setup();
    let p = projects.create("/project/fork", None).unwrap();
    let parent = chats
        .create(&NewChat {
            model: Some("claude-opus".to_string()),
            ..new_chat(&p.id)
        })
        .unwrap();

    let pf = pending_fork("parent-session-1");
    let fork = chats
        .create_fork(&ForkInsert {
            parent_chat_id: &parent.id,
            project_id: &p.id,
            adapter_id: "claude",
            model: Some("claude-opus"),
            permission_mode: Some(ExecutionMode::Default),
            plan_mode: true,
            effort: Some(EffortLevel::High),
            fast: Some(true),
            ultracode: Some(false),
            adaptive_thinking: Some(true),
            worktree_path: Some("/tmp/worktree"),
            branch_name: Some("feature/fork"),
            title: Some("Parent title (fork)"),
            pending_fork: &pf,
        })
        .unwrap();

    assert_eq!(fork.parent_chat_id, Some(Some(parent.id.clone())));
    assert_eq!(fork.project_id, p.id);
    assert_eq!(fork.adapter_id, "claude");
    assert_eq!(fork.model.as_deref(), Some("claude-opus"));
    assert_eq!(fork.permission_mode, Some(ExecutionMode::Default));
    assert_eq!(fork.plan_mode, Some(true));
    assert_eq!(fork.effort, Some(Some(EffortLevel::High)));
    assert_eq!(fork.fast, Some(Some(true)));
    assert_eq!(fork.ultracode, Some(Some(false)));
    assert_eq!(fork.adaptive_thinking, Some(Some(true)));
    assert_eq!(fork.worktree_path.as_deref(), Some("/tmp/worktree"));
    assert_eq!(fork.branch_name.as_deref(), Some("feature/fork"));
    assert_eq!(fork.title.as_deref(), Some("Parent title (fork)"));
    assert_eq!(fork.claude_session_id, None);
    assert_eq!(fork.total_cost, 0.0);
    assert_eq!(fork.total_tokens_input, 0);
    assert_eq!(fork.total_tokens_output, 0);
    assert_eq!(fork.pinned, None);
    assert_eq!(fork.tags, None);
    assert_eq!(fork.automation_run_id, None);

    // Round-trips through get() (the map_row path) too.
    let fetched = chats.get(&fork.id).unwrap().unwrap();
    assert_eq!(fetched.parent_chat_id, Some(Some(parent.id)));
    assert_eq!(fetched.model.as_deref(), Some("claude-opus"));
    assert_eq!(fetched.effort, Some(Some(EffortLevel::High)));
}

#[test]
fn parent_chat_id_survives_archive_and_unarchive() {
    let (chats, projects) = setup();
    let p = projects.create("/project/fork-archive", None).unwrap();
    let parent = chats.create(&new_chat(&p.id)).unwrap();
    let fork = chats
        .create_fork(&ForkInsert {
            parent_chat_id: &parent.id,
            project_id: &p.id,
            adapter_id: "claude",
            model: None,
            permission_mode: None,
            plan_mode: false,
            effort: None,
            fast: None,
            ultracode: None,
            adaptive_thinking: None,
            worktree_path: None,
            branch_name: None,
            title: None,
            pending_fork: &pending_fork("parent-session-2"),
        })
        .unwrap();

    chats
        .update(
            &fork.id,
            &ChatUpdate {
                status: Some(ChatStatus::Archived),
                ..Default::default()
            },
        )
        .unwrap();
    let archived = chats.get(&fork.id).unwrap().unwrap();
    assert_eq!(archived.status, ChatStatus::Archived);
    assert_eq!(archived.parent_chat_id, Some(Some(parent.id.clone())));

    chats
        .update(
            &fork.id,
            &ChatUpdate {
                status: Some(ChatStatus::Active),
                ..Default::default()
            },
        )
        .unwrap();
    let unarchived = chats.get(&fork.id).unwrap().unwrap();
    assert_eq!(unarchived.status, ChatStatus::Active);
    assert_eq!(unarchived.parent_chat_id, Some(Some(parent.id)));
}

#[test]
fn list_filtered_and_get_return_parent_chat_id() {
    let (chats, projects) = setup();
    let p = projects.create("/project/fork-list", None).unwrap();
    let parent = chats.create(&new_chat(&p.id)).unwrap();
    let fork = chats
        .create_fork(&ForkInsert {
            parent_chat_id: &parent.id,
            project_id: &p.id,
            adapter_id: "claude",
            model: None,
            permission_mode: None,
            plan_mode: false,
            effort: None,
            fast: None,
            ultracode: None,
            adaptive_thinking: None,
            worktree_path: None,
            branch_name: None,
            title: None,
            pending_fork: &pending_fork("parent-session-3"),
        })
        .unwrap();

    let listed = chats.list_filtered(&ChatListFilters::default()).unwrap();
    let listed_fork = listed.iter().find(|c| c.id == fork.id).unwrap();
    assert_eq!(listed_fork.parent_chat_id, Some(Some(parent.id.clone())));

    let listed_parent = listed.iter().find(|c| c.id == parent.id).unwrap();
    assert_eq!(listed_parent.parent_chat_id, Some(None));
}

#[test]
fn pending_fork_get_and_clear() {
    let (chats, projects) = setup();
    let p = projects.create("/project/pending-fork", None).unwrap();
    let parent = chats.create(&new_chat(&p.id)).unwrap();
    let pf = pending_fork("parent-session-4");
    let fork = chats
        .create_fork(&ForkInsert {
            parent_chat_id: &parent.id,
            project_id: &p.id,
            adapter_id: "claude",
            model: None,
            permission_mode: None,
            plan_mode: false,
            effort: None,
            fast: None,
            ultracode: None,
            adaptive_thinking: None,
            worktree_path: None,
            branch_name: None,
            title: None,
            pending_fork: &pf,
        })
        .unwrap();

    // A normal (non-fork) chat has no pending fork.
    assert_eq!(chats.get_pending_fork(&parent.id).unwrap(), None);

    let stored = chats.get_pending_fork(&fork.id).unwrap().unwrap();
    assert_eq!(stored, pf);

    chats.clear_pending_fork(&fork.id).unwrap();
    assert_eq!(chats.get_pending_fork(&fork.id).unwrap(), None);
}
