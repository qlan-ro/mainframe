//! `plan_coverage`: which segments a handoff covers, delta versus full.

use mainframe_types::segment::{
    HandoffStrategy, NativeSessionRecord, SegmentKind, SegmentLayout, SegmentRecord,
};

use crate::handoff::plan::{needs_fresh_fallback, plan_coverage};

fn native(id: &str, adapter: &str, native_id: Option<&str>, borrowed: bool) -> NativeSessionRecord {
    NativeSessionRecord {
        id: id.into(),
        adapter_id: adapter.into(),
        native_session_id: native_id.map(str::to_string),
        borrowed_from_chat_id: borrowed.then(|| "parent".to_string()),
        ..Default::default()
    }
}

fn seg(id: &str, ordinal: u32, native: &str, kind: SegmentKind, closed: bool) -> SegmentRecord {
    SegmentRecord {
        id: id.into(),
        ordinal,
        native_session_ref: native.into(),
        kind,
        closed_at: closed.then(|| "t".to_string()),
        ..Default::default()
    }
}

/// Claude (ns_c) → Codex (ns_x) → Claude again (ns_c, returning).
fn c_x_c() -> SegmentLayout {
    SegmentLayout {
        segments: vec![
            seg("s0", 0, "ns_c", SegmentKind::Initial, true),
            seg("s1", 1, "ns_x", SegmentKind::ProviderSwitch, true),
            seg("s2", 2, "ns_c", SegmentKind::ProviderSwitch, false),
        ],
        natives: vec![
            native("ns_c", "claude", Some("c"), false),
            native("ns_x", "codex", Some("x"), false),
        ],
        handoffs: vec![],
    }
}

#[test]
fn the_first_segment_and_context_resets_need_no_handoff() {
    let layout = c_x_c();
    assert_eq!(plan_coverage(&layout, &layout.segments[0], true), None);
    let reset = seg("s3", 3, "ns_c", SegmentKind::ContextReset, false);
    assert_eq!(plan_coverage(&layout, &reset, true), None);
}

#[test]
fn a_returning_session_gets_a_delta_of_only_what_it_missed() {
    let layout = c_x_c();
    let plan = plan_coverage(&layout, &layout.segments[2], true).unwrap();
    assert_eq!(plan.strategy, HandoffStrategy::Delta);
    assert_eq!(plan.ordinals, vec![1]);
}

#[test]
fn a_missing_transcript_or_fresh_session_gets_everything() {
    let layout = c_x_c();
    let plan = plan_coverage(&layout, &layout.segments[2], false).unwrap();
    assert_eq!(plan.strategy, HandoffStrategy::Full);
    assert_eq!(plan.ordinals, vec![0, 1]);

    let fresh = plan_coverage(&layout, &layout.segments[1], true).unwrap();
    assert_eq!(
        (fresh.strategy, fresh.ordinals),
        (HandoffStrategy::Full, vec![0])
    );
}

#[test]
fn a_borrowed_native_session_is_never_resumed() {
    let mut layout = c_x_c();
    layout.natives[0].borrowed_from_chat_id = Some("parent".into());
    let plan = plan_coverage(&layout, &layout.segments[2], true).unwrap();
    assert_eq!(plan.strategy, HandoffStrategy::Full);
}

#[test]
fn a_tiny_delta_budget_falls_back_to_fresh() {
    let layout = c_x_c();
    let plan = plan_coverage(&layout, &layout.segments[2], true).unwrap();
    assert!(needs_fresh_fallback(&plan, 2_047));
    assert!(!needs_fresh_fallback(&plan, 2_048));
}
