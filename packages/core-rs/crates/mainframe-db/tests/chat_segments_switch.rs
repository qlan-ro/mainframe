//! Provider segments: switch commits, handoff rows and per-segment counters.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_db::{DatabaseManager, SegmentResultDelta};
use mainframe_types::chat::{Chat, NewChat};
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::segment::{
    ClosedSnapshot, OpenNative, OpenSegment, PendingDeletion, SegmentKind, SwitchCommit,
    SwitchSettings,
};

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
            &ChatPatch {
                claude_session_id: Some(session.to_string()),
                ..Default::default()
            },
        )
        .unwrap();
}

fn switch_to_codex(db: &DatabaseManager, chat_id: &str) -> SwitchCommit {
    let layout = db.segments.layout(chat_id).unwrap();
    let active = layout.active().unwrap();
    SwitchCommit {
        chat_id: chat_id.to_string(),
        now: "2026-10-06T10:00:00Z".into(),
        delete_pending: None,
        close_active: Some(ClosedSnapshot {
            segment_id: active.id.clone(),
            native_ref: active.native_session_ref.clone(),
            model: Some("c-model".into()),
            tuning: None,
        }),
        reactivate_segment_id: None,
        open_segment: Some(OpenSegment {
            id: "seg_new".into(),
            ordinal: 1,
            kind: SegmentKind::ProviderSwitch,
            native: OpenNative::Fresh {
                id: "ns_new".into(),
                adapter_id: "codex".into(),
            },
        }),
        settings: SwitchSettings {
            adapter_id: "codex".into(),
            model: Some("x-model".into()),
            ..Default::default()
        },
        borrow_pinned: None,
    }
}

#[test]
fn commit_switch_opens_a_segment_and_moves_the_mirror() {
    let (_dir, db, pid) = open();
    let chat = new_chat(&db, &pid, "claude");
    set_session(&db, &chat.id, "c-sess");
    let layout = db
        .segments
        .commit_switch(&switch_to_codex(&db, &chat.id))
        .unwrap();
    assert_eq!(layout.segments.len(), 2);
    assert_eq!(layout.active().unwrap().id, "seg_new");
    let row = db.chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(row.adapter_id, "codex");
    assert_eq!(row.claude_session_id, None);
    assert_eq!(row.model.as_deref(), Some("x-model"));
    let first = layout
        .native(&layout.segments[0].native_session_ref)
        .unwrap();
    assert_eq!(first.model.as_deref(), Some("c-model"));
    assert!(db.segments.has_native_id(&chat.id).unwrap());

    // Switching back before sending deletes the pending segment and reactivates.
    let back = SwitchCommit {
        delete_pending: Some(PendingDeletion {
            segment_id: "seg_new".into(),
            native_ref: Some("ns_new".into()),
        }),
        close_active: None,
        reactivate_segment_id: Some(layout.segments[0].id.clone()),
        open_segment: None,
        settings: SwitchSettings {
            adapter_id: "claude".into(),
            model: Some("c-model".into()),
            ..Default::default()
        },
        ..switch_to_codex(&db, &chat.id)
    };
    let layout = db.segments.commit_switch(&back).unwrap();
    assert_eq!(layout.segments.len(), 1);
    assert_eq!(layout.natives.len(), 1);
    let row = db.chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(
        (row.adapter_id.as_str(), row.claude_session_id.as_deref()),
        ("claude", Some("c-sess"))
    );
}

#[test]
fn handoff_rows_supersede_deliver_and_stamp_the_marker() {
    let (_dir, db, pid) = open();
    let chat = new_chat(&db, &pid, "claude");
    set_session(&db, &chat.id, "c-sess");
    db.segments
        .commit_switch(&switch_to_codex(&db, &chat.id))
        .unwrap();
    let record = |id: &str| mainframe_types::segment::HandoffRecord {
        id: id.into(),
        chat_id: chat.id.clone(),
        target_segment_id: "seg_new".into(),
        strategy: mainframe_types::segment::HandoffStrategy::Full,
        covered_from_ordinal: 0,
        covered_to_ordinal: 0,
        item_count: 3,
        omitted_count: 1,
        budget_bytes: 16_000,
        used_bytes: 900,
        fell_back_to_fresh: false,
        status: mainframe_types::segment::HandoffStatus::Pending,
        created_at: "t".into(),
        delivered_at: None,
    };
    db.handoffs
        .insert_pending(&record("ho_1"), "seg_new")
        .unwrap();
    db.handoffs
        .insert_pending(&record("ho_2"), "other")
        .unwrap();
    let live = db.handoffs.live_for_segment("seg_new").unwrap().unwrap();
    assert_eq!(live.id, "ho_2");
    let layout = db.segments.layout(&chat.id).unwrap();
    assert_eq!(
        layout.active().unwrap().start_marker.as_deref(),
        Some("seg_new")
    );
    assert!(
        db.handoffs
            .set_status("ho_2", mainframe_types::segment::HandoffStatus::Delivered)
            .unwrap()
    );
    let wire = db.segments.list_wire(&chat.id).unwrap();
    let summary = wire[1].handoff.as_ref().unwrap();
    assert_eq!(
        summary.status,
        mainframe_types::segment::HandoffStatus::Delivered
    );
    assert_eq!((summary.item_count, summary.omitted_count), (3, 1));
}

#[test]
fn add_result_accumulates_on_the_active_segment_and_delete_cascades() {
    let (_dir, db, pid) = open();
    let chat = new_chat(&db, &pid, "claude");
    let delta = SegmentResultDelta {
        cost: 0.5,
        tokens_input: 10,
        tokens_output: 4,
        first_message_id: Some("u1".into()),
        last_message_id: Some("a1".into()),
    };
    db.segments.add_result(&chat.id, &delta).unwrap();
    db.segments
        .add_result(
            &chat.id,
            &SegmentResultDelta {
                first_message_id: Some("u2".into()),
                last_message_id: Some("a2".into()),
                ..delta
            },
        )
        .unwrap();
    let seg = db.segments.layout(&chat.id).unwrap().segments.remove(0);
    assert_eq!((seg.turn_count, seg.total_tokens_input), (2, 20));
    assert_eq!(seg.first_message_id.as_deref(), Some("u1"));
    assert_eq!(seg.last_message_id.as_deref(), Some("a2"));

    db.chats.delete(&chat.id).unwrap();
    let left: i64 = db
        .connection()
        .query_row("SELECT COUNT(*) FROM chat_native_sessions", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(left, 0);
}
