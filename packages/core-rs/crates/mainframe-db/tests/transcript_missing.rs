//! Ported from `packages/core/src/db/__tests__/transcript-missing.test.ts`.
//!
//! The `transcript_missing` column, its `mapRow` boolean coercion, and the
//! `clear_session` / `clear_worktree` degraded-recovery helpers. (The migration
//! that adds the column itself is version 25 in `mainframe-db::migrations`, with
//! its own test; here we exercise the repository read/write path.)
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::rc::Rc;

use rusqlite::Connection;

use mainframe_db::schema::initialize_schema;
use mainframe_db::{ChatUpdate, ChatsRepository, ProjectsRepository};

fn setup() -> (ChatsRepository, ProjectsRepository, String) {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    let conn = Rc::new(conn);
    let chats = ChatsRepository::new(Rc::clone(&conn), None);
    let projects = ProjectsRepository::new(Rc::clone(&conn));
    let project_id = projects.create("/project/transcripts", None).unwrap().id;
    (chats, projects, project_id)
}

#[test]
fn defaults_to_false_on_new_chats() {
    let (chats, _projects, project_id) = setup();
    let chat = chats.create(&project_id, "claude", None, None).unwrap();
    assert_eq!(
        chats.get(&chat.id).unwrap().unwrap().transcript_missing,
        Some(false)
    );
}

#[test]
fn persists_transcript_missing_through_update_and_maps_it_back_as_a_boolean() {
    let (chats, _projects, project_id) = setup();
    let chat = chats.create(&project_id, "claude", None, None).unwrap();

    chats
        .update(
            &chat.id,
            &ChatUpdate {
                transcript_missing: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        chats.get(&chat.id).unwrap().unwrap().transcript_missing,
        Some(true)
    );

    chats
        .update(
            &chat.id,
            &ChatUpdate {
                transcript_missing: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        chats.get(&chat.id).unwrap().unwrap().transcript_missing,
        Some(false)
    );
}

#[test]
fn includes_transcript_missing_in_list_results() {
    let (chats, _projects, project_id) = setup();
    let chat = chats.create(&project_id, "claude", None, None).unwrap();
    chats
        .update(
            &chat.id,
            &ChatUpdate {
                transcript_missing: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    let listed = chats
        .list(&project_id)
        .unwrap()
        .into_iter()
        .find(|c| c.id == chat.id)
        .unwrap();
    assert_eq!(listed.transcript_missing, Some(true));
}

#[test]
fn clear_session_clears_identity_and_resets_the_transcript_flag() {
    let (chats, _projects, project_id) = setup();
    let chat = chats.create(&project_id, "claude", None, None).unwrap();
    chats
        .update(
            &chat.id,
            &ChatUpdate {
                claude_session_id: Some("dead-session".to_string()),
                session_file_path: Some(
                    "/home/u/.claude/projects/x/dead-session.jsonl".to_string(),
                ),
                transcript_missing: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

    chats.clear_session(&chat.id).unwrap();

    let loaded = chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(loaded.claude_session_id, None);
    assert_eq!(loaded.session_file_path, None);
    assert_eq!(loaded.transcript_missing, Some(false));
}

#[test]
fn clear_worktree_clears_binding_so_chat_rebinds_to_project_root() {
    let (chats, _projects, project_id) = setup();
    let chat = chats.create(&project_id, "claude", None, None).unwrap();
    chats
        .update(
            &chat.id,
            &ChatUpdate {
                worktree_path: Some(Some("/project/.worktrees/feat-x".to_string())),
                branch_name: Some(Some("feat-x".to_string())),
                ..Default::default()
            },
        )
        .unwrap();

    chats.clear_worktree(&chat.id).unwrap();

    let loaded = chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(loaded.worktree_path, None);
    assert_eq!(loaded.branch_name, None);
}
