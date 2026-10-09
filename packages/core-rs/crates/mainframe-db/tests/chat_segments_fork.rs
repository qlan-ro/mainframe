//! Forks of multi-segment chats: `create_fork` copies the parent's segments
//! as planned, and a switch commit can turn an unsent fork's pinned native
//! row into a borrowed view of the parent.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_db::{ChatUpdate, DatabaseManager, ForkInsert, PendingFork};
use mainframe_types::adapter::ForkSource;
use mainframe_types::chat::{Chat, NewChat};
use mainframe_types::segment::{
    BorrowConversion, ClosedSnapshot, ForkPlan, ForkSegmentPlan, ForkSegmentRole, HandoffRecord,
    HandoffStatus, HandoffStrategy, OpenNative, OpenSegment, SegmentBound, SegmentKind,
    SegmentLayout, SwitchCommit, SwitchSettings,
};

fn open() -> (tempfile::TempDir, DatabaseManager, String) {
    let dir = tempfile::tempdir().unwrap();
    let db = DatabaseManager::open(&dir.path().join("t.db")).unwrap();
    let project_id = db.projects.create("/project/forks", None).unwrap().id;
    (dir, db, project_id)
}

fn set_session(db: &DatabaseManager, chat_id: &str, session: &str) {
    let update = ChatUpdate {
        claude_session_id: Some(session.to_string()),
        session_file_path: Some(format!("/t/{session}.jsonl")),
        ..Default::default()
    };
    db.chats.update(chat_id, &update).unwrap();
}

fn switch(db: &DatabaseManager, chat_id: &str, to: &str, segment: &str) -> SwitchCommit {
    let layout = db.segments.layout(chat_id).unwrap();
    let active = layout.active().unwrap();
    SwitchCommit {
        chat_id: chat_id.to_string(),
        now: "2026-10-06T10:00:00Z".into(),
        delete_pending: None,
        close_active: Some(ClosedSnapshot {
            segment_id: active.id.clone(),
            native_ref: active.native_session_ref.clone(),
            model: None,
            tuning: None,
        }),
        reactivate_segment_id: None,
        open_segment: Some(OpenSegment {
            id: segment.into(),
            ordinal: active.ordinal + 1,
            kind: SegmentKind::ProviderSwitch,
            native: OpenNative::Fresh {
                id: format!("ns_{segment}"),
                adapter_id: to.into(),
            },
        }),
        settings: SwitchSettings {
            adapter_id: to.into(),
            ..Default::default()
        },
        borrow_pinned: None,
    }
}

fn delivered_handoff(chat_id: &str, segment: &str) -> HandoffRecord {
    HandoffRecord {
        id: format!("ho_{segment}"),
        chat_id: chat_id.into(),
        target_segment_id: segment.into(),
        strategy: HandoffStrategy::Full,
        covered_from_ordinal: 0,
        covered_to_ordinal: 0,
        item_count: 4,
        omitted_count: 1,
        budget_bytes: 16_000,
        used_bytes: 700,
        fell_back_to_fresh: false,
        status: HandoffStatus::Pending,
        created_at: "t".into(),
        delivered_at: None,
    }
}

/// Claude (c-sess), then Codex (x-sess) with a delivered handoff; Codex active.
fn claude_then_codex(db: &DatabaseManager, project_id: &str) -> (Chat, SegmentLayout) {
    let new = NewChat {
        project_id: project_id.to_string(),
        adapter_id: "claude".to_string(),
        ..Default::default()
    };
    let parent = db.chats.create(&new).unwrap();
    set_session(db, &parent.id, "c-sess");
    let delta = mainframe_db::SegmentResultDelta {
        cost: 1.0,
        last_message_id: Some("c-a1".into()),
        ..Default::default()
    };
    db.segments.add_result(&parent.id, &delta).unwrap();
    let commit = switch(db, &parent.id, "codex", "seg_x");
    db.segments.commit_switch(&commit).unwrap();
    set_session(db, &parent.id, "x-sess");
    let handoff = delivered_handoff(&parent.id, "seg_x");
    db.handoffs.insert_pending(&handoff, "seg_x").unwrap();
    db.handoffs
        .set_status(&handoff.id, HandoffStatus::Delivered)
        .unwrap();
    let layout = db.segments.layout(&parent.id).unwrap();
    (parent, layout)
}

fn plan_for(layout: &SegmentLayout) -> ForkPlan {
    let first = &layout.segments[0];
    ForkPlan {
        segments: vec![
            ForkSegmentPlan {
                source_segment_id: first.id.clone(),
                ordinal: 0,
                kind: first.kind,
                role: ForkSegmentRole::Borrowed {
                    end_message_id: Some("c-a1".into()),
                    end_at: first.closed_at.clone(),
                },
            },
            ForkSegmentPlan {
                source_segment_id: "seg_x".into(),
                ordinal: 1,
                kind: SegmentKind::ProviderSwitch,
                role: ForkSegmentRole::Pinned,
            },
        ],
        pending_active: false,
    }
}

fn pending_fork() -> PendingFork {
    PendingFork {
        fork_source: ForkSource {
            source_session_id: "x-sess".into(),
            resume_path: None,
            last_turn_id: Some("turn-3".into()),
        },
        snapshot_dir: "/tmp/fork-snapshots/n1".into(),
        provisional_title: "Untitled (fork)".into(),
    }
}

fn fork_of(db: &DatabaseManager, parent: &Chat, plan: Option<&ForkPlan>) -> Chat {
    let pending = pending_fork();
    let insert = ForkInsert {
        parent_chat_id: &parent.id,
        project_id: &parent.project_id,
        adapter_id: "codex",
        model: Some("x-model"),
        permission_mode: None,
        plan_mode: false,
        effort: None,
        fast: None,
        ultracode: None,
        adaptive_thinking: None,
        worktree_path: None,
        branch_name: None,
        title: Some("Untitled (fork)"),
        pending_fork: &pending,
        segments: plan,
    };
    db.chats.create_fork(&insert).unwrap()
}

#[test]
fn a_fork_copies_borrowed_and_pinned_segments() {
    let (_dir, db, pid) = open();
    let (parent, layout) = claude_then_codex(&db, &pid);
    let fork = fork_of(&db, &parent, Some(&plan_for(&layout)));

    let copied = db.segments.layout(&fork.id).unwrap();
    assert_eq!(copied.segments.len(), 2);
    let borrowed_seg = &copied.segments[0];
    let borrowed = copied.native(&borrowed_seg.native_session_ref).unwrap();
    assert_eq!(
        borrowed.borrowed_from_chat_id.as_deref(),
        Some(parent.id.as_str())
    );
    assert_eq!(borrowed.native_session_id.as_deref(), Some("c-sess"));
    assert_eq!(borrowed_seg.end_bound_message_id.as_deref(), Some("c-a1"));
    assert_eq!(borrowed_seg.turn_count, 1);
    assert_eq!(borrowed_seg.total_cost, 0.0);
    assert!(borrowed_seg.closed_at.is_some());

    let active = copied.active().unwrap();
    assert_eq!(
        (active.ordinal, active.kind),
        (1, SegmentKind::ProviderSwitch)
    );
    assert_eq!(active.start_marker.as_deref(), Some("seg_x"));
    let pinned = copied.native(&active.native_session_ref).unwrap();
    assert_eq!(
        (
            pinned.adapter_id.as_str(),
            pinned.native_session_id.as_deref()
        ),
        ("codex", None)
    );
    assert!(pinned.borrowed_from_chat_id.is_none());
    let handoff = copied.handoff_for(&active.id).unwrap();
    assert_eq!(
        (handoff.status, handoff.item_count),
        (HandoffStatus::Delivered, 4)
    );

    let row = db.chats.get(&fork.id).unwrap().unwrap();
    assert_eq!(
        (row.adapter_id.as_str(), row.claude_session_id.as_deref()),
        ("codex", None)
    );
    // The parent is never mutated.
    assert_eq!(db.segments.layout(&parent.id).unwrap(), layout);
}

#[test]
fn a_fork_without_a_plan_seeds_one_initial_segment() {
    let (_dir, db, pid) = open();
    let (parent, _) = claude_then_codex(&db, &pid);
    let fork = fork_of(&db, &parent, None);
    let layout = db.segments.layout(&fork.id).unwrap();
    assert_eq!(layout.segments.len(), 1);
    assert_eq!(layout.segments[0].kind, SegmentKind::Initial);
}

#[test]
fn a_pending_active_plan_opens_a_fresh_segment_for_the_parent_adapter() {
    let (_dir, db, pid) = open();
    let (parent, layout) = claude_then_codex(&db, &pid);
    let mut plan = plan_for(&layout);
    plan.segments.truncate(1);
    plan.pending_active = true;
    let fork = fork_of(&db, &parent, Some(&plan));
    let copied = db.segments.layout(&fork.id).unwrap();
    assert_eq!(copied.segments.len(), 2);
    let active = copied.active().unwrap();
    assert_eq!(active.ordinal, 1);
    let native = copied.native(&active.native_session_ref).unwrap();
    assert_eq!(
        (
            native.adapter_id.as_str(),
            native.native_session_id.as_deref()
        ),
        ("codex", None)
    );
}

#[test]
fn a_switch_turns_the_unsent_fork_pin_into_a_borrowed_view() {
    let (_dir, db, pid) = open();
    let (parent, layout) = claude_then_codex(&db, &pid);
    let fork = fork_of(&db, &parent, Some(&plan_for(&layout)));
    let active = db
        .segments
        .layout(&fork.id)
        .unwrap()
        .active()
        .cloned()
        .unwrap();
    let mut commit = switch(&db, &fork.id, "claude", "seg_back");
    commit.borrow_pinned = Some(BorrowConversion {
        chat_id: fork.id.clone(),
        native_ref: active.native_session_ref.clone(),
        owner_chat_id: parent.id.clone(),
        native_session_id: "x-sess".into(),
        session_file_path: Some("/t/x-sess.jsonl".into()),
        bounds: vec![SegmentBound {
            segment_id: active.id.clone(),
            end_message_id: Some("x-a2".into()),
            end_at: Some("2026-10-06T09:00:00Z".into()),
        }],
    });
    let after = db.segments.commit_switch(&commit).unwrap();

    let converted = after.native(&active.native_session_ref).unwrap();
    assert_eq!(
        converted.borrowed_from_chat_id.as_deref(),
        Some(parent.id.as_str())
    );
    assert_eq!(converted.native_session_id.as_deref(), Some("x-sess"));
    let bounded = after.segments.iter().find(|s| s.id == active.id).unwrap();
    assert_eq!(bounded.end_bound_message_id.as_deref(), Some("x-a2"));
    assert!(bounded.closed_at.is_some());
    assert_eq!(after.active().unwrap().id, "seg_back");
    assert_eq!(db.chats.get_pending_fork(&fork.id).unwrap(), None);
    // Borrowed rows never count as the fork's own session.
    assert!(!db.segments.has_native_id(&fork.id).unwrap());
    let row = db.chats.get(&fork.id).unwrap().unwrap();
    assert_eq!(
        (row.adapter_id.as_str(), row.claude_session_id.as_deref()),
        ("claude", None)
    );
}
