//! `create` and `create_fork` return the row exactly as a later `get` reads
//! it, so the `chat.created` payload a client receives carries the same keys
//! as every `chat.updated` for that row.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeSet;

use mainframe_db::{DatabaseManager, ForkInsert, PendingFork};
use mainframe_types::adapter::{EffortLevel, ForkSource};
use mainframe_types::chat::{Chat, NO_PROJECT_ID, NewChat};
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;

fn open() -> (tempfile::TempDir, DatabaseManager, String) {
    let dir = tempfile::tempdir().unwrap();
    let db = DatabaseManager::open(&dir.path().join("t.db")).unwrap();
    let project_id = db.projects.create("/project/round-trip", None).unwrap().id;
    (dir, db, project_id)
}

fn new_chat(project_id: &str) -> NewChat {
    NewChat {
        project_id: project_id.to_string(),
        adapter_id: "claude".to_string(),
        ..Default::default()
    }
}

fn fork_of(db: &DatabaseManager, parent: &Chat, pending: &PendingFork) -> Chat {
    db.chats
        .create_fork(&ForkInsert {
            parent_chat_id: &parent.id,
            project_id: &parent.project_id,
            adapter_id: "claude",
            model: Some("claude-opus"),
            permission_mode: Some(ExecutionMode::AcceptEdits),
            plan_mode: false,
            effort: Some(EffortLevel::High),
            fast: None,
            ultracode: Some(true),
            adaptive_thinking: None,
            worktree_path: Some("/tmp/fork-worktree"),
            branch_name: Some("feature/fork"),
            title: Some("Parent (fork)"),
            pending_fork: pending,
            segments: None,
        })
        .unwrap()
}

fn pending_fork() -> PendingFork {
    PendingFork {
        fork_source: ForkSource {
            source_session_id: "parent-session".to_string(),
            resume_path: None,
            last_turn_id: None,
        },
        snapshot_dir: "/tmp/fork-snapshots/round-trip".to_string(),
        provisional_title: "Parent (fork)".to_string(),
    }
}

/// The keys of the `chat` object inside a serialised daemon event.
fn chat_keys(event: &DaemonEvent) -> BTreeSet<String> {
    let value = serde_json::to_value(event).unwrap();
    value["chat"]
        .as_object()
        .expect("event carries a chat object")
        .keys()
        .cloned()
        .collect()
}

fn keys(list: &[&str]) -> BTreeSet<String> {
    list.iter().map(|k| (*k).to_string()).collect()
}

#[test]
fn create_returns_the_row_exactly_as_get_reads_it() {
    let (_dir, db, project_id) = open();
    let created = db
        .chats
        .create(&NewChat {
            model: Some("claude-sonnet".to_string()),
            permission_mode: Some("acceptEdits".to_string()),
            ..new_chat(&project_id)
        })
        .unwrap();

    let fetched = db.chats.get(&created.id).unwrap().unwrap();
    assert_eq!(created, fetched);

    // Stated values for the fields `create` used to seed as absent.
    assert_eq!(created.mentions, Some(vec![]));
    assert_eq!(created.modified_files, Some(vec![]));
    assert_eq!(created.detected_prs, Some(vec![]));
    assert_eq!(created.process_state, Some(None));
    assert_eq!(created.transcript_missing, Some(false));
    assert_eq!(created.pinned, Some(false));
    assert_eq!(created.fast, Some(None));
    assert_eq!(created.ultracode, Some(None));
    assert_eq!(created.adaptive_thinking, Some(None));
    assert_eq!(created.parent_chat_id, Some(None));
    assert_eq!(created.tags, Some(vec![]));
}

#[test]
fn create_reads_back_the_stored_scratch_path_for_a_no_project_chat() {
    let (_dir, db, _project_id) = open();
    let created = db
        .chats
        .create(&NewChat {
            scratch_root: Some("/data/scratch".to_string()),
            ..new_chat(NO_PROJECT_ID)
        })
        .unwrap();

    assert_eq!(created, db.chats.get(&created.id).unwrap().unwrap());
    assert!(created.no_project);
    assert_eq!(
        created.scratch_path,
        Some(format!("/data/scratch/{}", created.id))
    );
}

#[test]
fn create_fork_returns_the_row_exactly_as_get_reads_it() {
    let (_dir, db, project_id) = open();
    let parent = db.chats.create(&new_chat(&project_id)).unwrap();
    let pending = pending_fork();
    let fork = fork_of(&db, &parent, &pending);

    let fetched = db.chats.get(&fork.id).unwrap().unwrap();
    assert_eq!(fork, fetched);

    assert_eq!(fork.effort, Some(Some(EffortLevel::High)));
    assert_eq!(fork.fast, Some(None));
    assert_eq!(fork.ultracode, Some(Some(true)));
    assert_eq!(fork.adaptive_thinking, Some(None));
    assert_eq!(fork.pinned, Some(false));
    assert_eq!(fork.mentions, Some(vec![]));
    assert_eq!(fork.process_state, Some(None));
    assert_eq!(fork.transcript_missing, Some(false));
    assert_eq!(fork.parent_chat_id, Some(Some(parent.id.clone())));
    assert_eq!(fork.tags, Some(vec![]));
}

/// Keys every persisted chat carries before any optional column is set.
const BASE_KEYS: &[&str] = &[
    "id",
    "adapterId",
    "projectId",
    "planMode",
    "status",
    "createdAt",
    "updatedAt",
    "totalCost",
    "totalTokensInput",
    "totalTokensOutput",
    "lastContextTokensInput",
    "mentions",
    "modifiedFiles",
    "processState",
    "transcriptMissing",
    "pinned",
    "fast",
    "ultracode",
    "adaptiveThinking",
    "detectedPrs",
    "tags",
    "temporary",
    "noProject",
    "parentChatId",
];

#[test]
fn chat_created_carries_the_same_keys_as_chat_updated_for_the_same_row() {
    let (_dir, db, project_id) = open();
    let created = db.chats.create(&new_chat(&project_id)).unwrap();
    let reread = db.chats.get(&created.id).unwrap().unwrap();

    let created_keys = chat_keys(&DaemonEvent::ChatCreated {
        chat: created,
        source: None,
    });
    let updated_keys = chat_keys(&DaemonEvent::ChatUpdated {
        chat: reread,
        reason: None,
    });

    assert_eq!(created_keys, keys(BASE_KEYS));
    assert_eq!(updated_keys, keys(BASE_KEYS));
}

#[test]
fn fork_chat_created_carries_the_same_keys_as_chat_updated_for_the_same_row() {
    let (_dir, db, project_id) = open();
    let parent = db.chats.create(&new_chat(&project_id)).unwrap();
    let pending = pending_fork();
    let fork = fork_of(&db, &parent, &pending);
    let reread = db.chats.get(&fork.id).unwrap().unwrap();

    let created_keys = chat_keys(&DaemonEvent::ChatCreated {
        chat: fork,
        source: None,
    });
    let updated_keys = chat_keys(&DaemonEvent::ChatUpdated {
        chat: reread,
        reason: None,
    });

    let mut expected = keys(BASE_KEYS);
    expected.extend(keys(&[
        "title",
        "model",
        "permissionMode",
        "worktreePath",
        "branchName",
        "effort",
    ]));
    assert_eq!(created_keys, expected);
    assert_eq!(updated_keys, expected);
}
