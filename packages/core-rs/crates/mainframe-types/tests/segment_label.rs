//! `ProviderSwitchMarker::label` — the divider text older clients render.
//! Mirrors `providerSwitchLabel` in `packages/types/src/segment.ts`; both
//! suites assert the same strings.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_types::segment::{
    HandoffStatus, HandoffStrategy, HandoffSummary, ProviderSwitchMarker, SegmentKind,
    SegmentTotals,
};

fn marker(resumed: bool, handoff: Option<(u32, u32, bool)>) -> ProviderSwitchMarker {
    ProviderSwitchMarker {
        segment_id: "seg_1".into(),
        kind: SegmentKind::ProviderSwitch,
        from_adapter_id: "claude".into(),
        to_adapter_id: "codex".into(),
        from_adapter_name: "Claude".into(),
        to_adapter_name: "Codex".into(),
        to_model: None,
        resumed,
        previous: SegmentTotals::default(),
        handoff: handoff.map(|(items, omitted, fresh)| HandoffSummary {
            id: "ho_1".into(),
            strategy: HandoffStrategy::Full,
            status: HandoffStatus::Delivered,
            item_count: items,
            omitted_count: omitted,
            fell_back_to_fresh: fresh,
        }),
    }
}

#[test]
fn every_divider_state_has_its_label() {
    assert_eq!(
        marker(false, None).label(),
        "Switched to Codex · context hands off with your next message"
    );
    assert_eq!(
        marker(false, Some((12, 3, false))).label(),
        "Switched to Codex · context handed off (12 items, 3 omitted)"
    );
    assert_eq!(
        marker(true, None).label(),
        "Back to Codex · resumes its earlier session with your next message"
    );
    assert_eq!(
        marker(true, Some((1, 0, false))).label(),
        "Back to Codex · resumed earlier session · caught up (1 item)"
    );
    assert_eq!(
        marker(false, Some((4, 0, true))).label(),
        "Back to Codex · new session · context handed off (4 items)"
    );
    let mut reset = marker(false, None);
    reset.kind = SegmentKind::ContextReset;
    reset.to_adapter_name = "Claude".into();
    assert_eq!(
        reset.label(),
        "New Claude session · earlier context cleared"
    );
}

#[test]
fn the_marker_serializes_with_camel_case_and_null_fields() {
    let json = serde_json::to_value(marker(false, None)).unwrap();
    assert_eq!(json["segmentId"], "seg_1");
    assert_eq!(json["kind"], "provider_switch");
    assert!(json["handoff"].is_null());
    assert!(json["toModel"].is_null());
}
