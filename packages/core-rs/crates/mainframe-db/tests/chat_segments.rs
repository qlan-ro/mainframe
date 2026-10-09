//! Provider segments (migration 31): backfill, the `chats` mirror invariant,
//! the `record_native_id` rule, insert-path seeding, and dedupe.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rusqlite::Connection;

use mainframe_db::migrations::run_migrations;
use mainframe_db::{ChatUpdate, DatabaseManager, RecordOutcome, SegmentResultDelta};
use mainframe_types::chat::{Chat, NewChat};
use mainframe_types::segment::{HandoffRecord, HandoffStatus, HandoffStrategy, SegmentKind};

fn open() -> (tempfile::TempDir, DatabaseManager, String) {
    let dir = tempfile::tempdir().unwrap();
    let db = DatabaseManager::open(&dir.path().join("t.db")).unwrap();
    let project_id = db.projects.create("/project/segments", None).unwrap().id;
    (dir, db, project_id)
}

fn new_chat(db: &DatabaseManager, project_id: &str, adapter: &str) -> Chat {
    db.chats
        .create(&NewChat {
            project_id: project_id.to_string(),
            adapter_id: adapter.to_string(),
            ..Default::default()
        })
        .unwrap()
}

fn set_session(db: &DatabaseManager, chat_id: &str, session: &str) {
    db.chats
        .update(
            chat_id,
            &ChatUpdate {
                claude_session_id: Some(session.to_string()),
                ..Default::default()
            },
        )
        .unwrap();
}

/// (chat_id, adapter_id, native_session_id, last_context_total_tokens, transcript_missing)
type NativeRow = (String, String, Option<String>, Option<i64>, i64);

#[test]
fn migration_31_backfills_one_active_initial_segment_per_chat() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn, 30).unwrap();
    conn.execute_batch(
        "INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES ('p', 'p', '/p', 't', 't');
         INSERT INTO chats (id, adapter_id, project_id, claude_session_id, session_file_path, model,
           created_at, updated_at, total_cost, total_tokens_input, total_tokens_output,
           last_context_total_tokens, last_context_max_tokens, transcript_missing)
         VALUES ('c1', 'claude', 'p', 'sess-1', '/x/sess-1.jsonl', 'm1', 't0', 't1', 1.5, 10, 20, 300, 1000, 1),
                ('c2', 'codex', 'p', NULL, NULL, NULL, 't0', 't1', 0, 0, 0, NULL, NULL, 0);",
    )
    .unwrap();
    run_migrations(&conn, 31).unwrap();

    let natives: Vec<NativeRow> = {
        let mut stmt = conn
            .prepare("SELECT chat_id, adapter_id, native_session_id, last_context_total_tokens, transcript_missing FROM chat_native_sessions ORDER BY chat_id")
            .unwrap();
        stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
    };
    assert_eq!(
        natives,
        vec![
            (
                "c1".into(),
                "claude".into(),
                Some("sess-1".into()),
                Some(300),
                1
            ),
            ("c2".into(), "codex".into(), None, None, 0),
        ]
    );
    let (kind, ordinal, cost, closed): (String, i64, f64, Option<String>) = conn
        .query_row(
            "SELECT kind, ordinal, total_cost, closed_at FROM chat_segments WHERE chat_id = 'c1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(
        (kind.as_str(), ordinal, cost, closed),
        ("initial", 0, 1.5, None)
    );
    // A legacy re-run of the chain stays a no-op.
    conn.pragma_update(None, "user_version", 30).unwrap();
    run_migrations(&conn, 31).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM chat_segments", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2);
}

#[test]
fn only_one_active_segment_per_chat() {
    let (_dir, db, pid) = open();
    let chat = new_chat(&db, &pid, "claude");
    let err = db.connection().execute(
        "INSERT INTO chat_segments (id, chat_id, ordinal, native_session_ref, kind, created_at) \
         VALUES ('x', ?, 1, ?, 'context_reset', 't')",
        rusqlite::params![chat.id, format!("ns_{}", chat.id)],
    );
    assert!(
        err.is_err(),
        "a second active segment must violate the unique index"
    );
}

#[test]
fn every_insert_path_seeds_the_initial_rows() {
    let (_dir, db, pid) = open();
    let chat = new_chat(&db, &pid, "claude");
    let (side, created) = db.chats.find_or_create_side_chat(&chat).unwrap();
    assert!(created);
    for id in [&chat.id, &side.id] {
        let layout = db.segments.layout(id).unwrap();
        assert_eq!(layout.segments.len(), 1);
        assert_eq!(layout.segments[0].kind, SegmentKind::Initial);
        assert!(layout.active().is_some());
        assert_eq!(layout.natives.len(), 1);
    }
}

#[test]
fn record_native_id_sets_ignores_and_resets() {
    let (_dir, db, pid) = open();
    let chat = new_chat(&db, &pid, "claude");
    let path = Some("/t/a.jsonl");
    assert_eq!(
        db.segments.record_native_id(&chat.id, "a", path).unwrap(),
        RecordOutcome::Set
    );
    assert_eq!(
        db.segments.record_native_id(&chat.id, "a", path).unwrap(),
        RecordOutcome::Unchanged
    );
    // A turn must have actually run on "a" for a later, different id to be a
    // genuine context reset (Claude `/clear` mid-conversation) rather than
    // the adapter still resolving its own native id for this spawn.
    db.segments
        .add_result(&chat.id, &SegmentResultDelta::default())
        .unwrap();
    let RecordOutcome::Reset { segment_id } =
        db.segments.record_native_id(&chat.id, "b", None).unwrap()
    else {
        panic!("a different id after a turn ran must open a context reset");
    };
    let layout = db.segments.layout(&chat.id).unwrap();
    assert_eq!(layout.segments.len(), 2);
    let active = layout.active().unwrap();
    assert_eq!(active.id, segment_id);
    assert_eq!(active.kind, SegmentKind::ContextReset);
    // The closed segment keeps its native id: its history stays readable.
    let first = layout
        .native(&layout.segments[0].native_session_ref)
        .unwrap();
    assert_eq!(first.native_session_id.as_deref(), Some("a"));
    assert_eq!(
        db.chats
            .get(&chat.id)
            .unwrap()
            .unwrap()
            .claude_session_id
            .as_deref(),
        Some("b")
    );
}

/// #772 live QA: a Claude→Codex round trip got 4 segment rows instead of 3,
/// and the handoff into the Codex segment stayed `pending` forever. Codex's
/// `on_init` fires twice per spawn — immediately with a local placeholder id,
/// then again with the real native thread id once `thread/started` names it
/// — and the active segment has not run a turn between the two calls. That
/// must rebind the same native row and segment, not open a `context_reset`
/// that orphans the pending handoff on a segment nothing will ever mark
/// active again.
#[test]
fn record_native_id_rebinds_a_still_empty_segment_instead_of_resetting() {
    let (_dir, db, pid) = open();
    let chat = new_chat(&db, &pid, "codex");
    // `chats.rs::update` routes `claude_session_id` and `session_file_path`
    // through separate `EventChatUpdate`s (see `handle_init`), so the path
    // argument here is `None`, matching the real call site.
    assert_eq!(
        db.segments
            .record_native_id(&chat.id, "placeholder-nanoid", None)
            .unwrap(),
        RecordOutcome::Set
    );
    let layout = db.segments.layout(&chat.id).unwrap();
    let segment_id = layout.active().unwrap().id.clone();
    db.handoffs
        .insert_pending(
            &HandoffRecord {
                id: "ho1".into(),
                chat_id: chat.id.clone(),
                target_segment_id: segment_id.clone(),
                strategy: HandoffStrategy::Full,
                covered_from_ordinal: 0,
                covered_to_ordinal: 0,
                item_count: 2,
                omitted_count: 0,
                budget_bytes: 100,
                used_bytes: 10,
                fell_back_to_fresh: false,
                status: HandoffStatus::Pending,
                created_at: "2026-10-08T08:32:00Z".into(),
                delivered_at: None,
            },
            "m1",
        )
        .unwrap();

    // `thread/started` names the real thread, before any turn ran.
    assert_eq!(
        db.segments
            .record_native_id(&chat.id, "thread_real", None)
            .unwrap(),
        RecordOutcome::Rebound
    );

    let layout = db.segments.layout(&chat.id).unwrap();
    assert_eq!(layout.segments.len(), 1, "no stray context_reset segment");
    let active = layout.active().unwrap();
    assert_eq!(active.id, segment_id, "the original segment stays active");
    let native = layout.native(&active.native_session_ref).unwrap();
    assert_eq!(native.native_session_id.as_deref(), Some("thread_real"));
    // The handoff is still live on the (unchanged) active segment, so the
    // next turn result will mark it delivered instead of leaving it pending
    // forever.
    let handoff = layout.handoff_for(&segment_id).unwrap();
    assert_eq!(handoff.status, HandoffStatus::Pending);
    assert_eq!(
        db.chats
            .get(&chat.id)
            .unwrap()
            .unwrap()
            .claude_session_id
            .as_deref(),
        Some("thread_real")
    );
}

#[test]
fn chats_update_keeps_the_mirror_equal_to_the_active_native_row() {
    let (_dir, db, pid) = open();
    let chat = new_chat(&db, &pid, "claude");
    db.chats
        .update(
            &chat.id,
            &ChatUpdate {
                claude_session_id: Some("s1".into()),
                session_file_path: Some("/f/s1.jsonl".into()),
                last_context_total_tokens: Some(500),
                last_context_max_tokens: Some(2000),
                ..Default::default()
            },
        )
        .unwrap();
    let layout = db.segments.layout(&chat.id).unwrap();
    let native = layout
        .native(&layout.active().unwrap().native_session_ref)
        .unwrap();
    let row = db.chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(native.native_session_id, row.claude_session_id);
    assert_eq!(native.session_file_path, row.session_file_path);
    assert_eq!(
        native.last_context_total_tokens,
        row.last_context_total_tokens
    );
    assert_eq!(native.last_context_max_tokens, row.last_context_max_tokens);
}

#[test]
fn clear_session_opens_a_context_reset_and_keeps_dedupe() {
    let (_dir, db, pid) = open();
    let chat = new_chat(&db, &pid, "claude");
    set_session(&db, &chat.id, "old");
    db.chats.clear_session(&chat.id).unwrap();
    let row = db.chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(row.claude_session_id, None);
    let layout = db.segments.layout(&chat.id).unwrap();
    assert_eq!(layout.segments.len(), 2);
    assert_eq!(layout.active().unwrap().kind, SegmentKind::ContextReset);
    // A session the chat used earlier still counts as imported.
    assert_eq!(
        db.chats.get_imported_session_ids(&pid).unwrap(),
        vec!["old".to_string()]
    );
    assert_eq!(
        db.chats
            .find_by_external_session_id("old", &pid)
            .unwrap()
            .unwrap()
            .id,
        chat.id
    );
    // A second clear on a segment that never ran reuses it.
    db.chats.clear_session(&chat.id).unwrap();
    assert_eq!(db.segments.layout(&chat.id).unwrap().segments.len(), 2);
}

#[test]
fn mark_context_lost_clears_an_unshared_native_id_in_place() {
    let (_dir, db, pid) = open();
    let chat = new_chat(&db, &pid, "claude");
    set_session(&db, &chat.id, "eph");
    db.chats
        .mark_context_lost(&chat.id, "2026-01-01T00:00:00Z")
        .unwrap();
    let row = db.chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(row.claude_session_id, None);
    assert_eq!(row.context_lost_at.as_deref(), Some("2026-01-01T00:00:00Z"));
    assert_eq!(db.segments.layout(&chat.id).unwrap().segments.len(), 1);
}
