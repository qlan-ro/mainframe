//! `plan_switch`: new segment, delete-pending-and-reactivate, returning to
//! the newest owned session, missing transcripts, borrowed rows, settings.

use mainframe_types::chat::{Chat, SessionTuning};
use mainframe_types::segment::{OpenNative, SegmentKind, SegmentLayout};
use mainframe_types::settings::ExecutionMode;

use super::*;
use crate::segments::switch_plan::{SwitchPlanInput, plan_switch};

fn chat(adapter: &str) -> Chat {
    let mut chat = crate::test_support::test_chat("chat_1");
    chat.adapter_id = adapter.into();
    chat.model = Some("claude-model".into());
    chat.permission_mode = Some(ExecutionMode::Auto);
    chat.plan_mode = Some(true);
    chat
}

fn input<'a>(chat: &'a Chat, layout: &'a SegmentLayout, target: &'a str) -> SwitchPlanInput<'a> {
    SwitchPlanInput {
        chat,
        layout,
        target_adapter: target,
        requested_model: None,
        requested_tuning: None,
        default_model: Some("codex-default"),
        target_auto_mode: false,
        target_plan_mode: true,
        now: "2026-10-06T10:00:00Z",
        new_segment_id: "seg_new",
        new_native_id: "ns_new",
    }
}

/// One Claude segment that ran.
fn claude_only() -> SegmentLayout {
    let mut layout = c_x_c();
    layout.segments.truncate(1);
    layout.segments[0].closed_at = None;
    layout.segments[0].turn_count = 3;
    layout.natives.truncate(1);
    layout.handoffs.clear();
    layout
}

#[test]
fn switching_away_closes_the_active_segment_and_opens_a_fresh_one() {
    let chat = chat("claude");
    let layout = claude_only();
    let commit = plan_switch(&input(&chat, &layout, "codex")).unwrap();
    let closed = commit.close_active.unwrap();
    assert_eq!(
        (closed.segment_id.as_str(), closed.model.as_deref()),
        ("s0", Some("claude-model"))
    );
    let open = commit.open_segment.unwrap();
    assert_eq!(open.kind, SegmentKind::ProviderSwitch);
    assert_eq!(
        open.native,
        OpenNative::Fresh {
            id: "ns_new".into(),
            adapter_id: "codex".into()
        }
    );
    // Default model, auto dropped to default, plan mode kept.
    assert_eq!(commit.settings.model.as_deref(), Some("codex-default"));
    assert_eq!(
        commit.settings.permission_mode,
        Some(ExecutionMode::Default)
    );
    assert!(commit.settings.plan_mode);
}

#[test]
fn switching_back_before_sending_deletes_the_pending_segment_and_reactivates() {
    let chat = chat("codex");
    let mut layout = claude_only();
    layout.segments[0].closed_at = Some("t".into());
    let mut pending = segment("s1", 1, "ns_x", SegmentKind::ProviderSwitch);
    pending.closed_at = None;
    layout.segments.push(pending);
    layout.natives.push(native("ns_x", "codex", None));
    let commit = plan_switch(&input(&chat, &layout, "claude")).unwrap();
    let deletion = commit.delete_pending.unwrap();
    assert_eq!(
        (deletion.segment_id.as_str(), deletion.native_ref.as_deref()),
        ("s1", Some("ns_x"))
    );
    assert_eq!(commit.reactivate_segment_id.as_deref(), Some("s0"));
    assert!(commit.open_segment.is_none());
    assert!(commit.close_active.is_none());
}

#[test]
fn returning_picks_the_newest_owned_session_and_restores_its_snapshot() {
    let chat = chat("codex");
    let mut layout = claude_only();
    layout.segments[0].closed_at = Some("t".into());
    layout.natives[0].model = Some("claude-old".into());
    layout.natives[0].tuning = Some(SessionTuning {
        fast: Some(Some(true)),
        ..Default::default()
    });
    let mut codex = segment("s1", 1, "ns_x", SegmentKind::ProviderSwitch);
    codex.closed_at = None;
    codex.turn_count = 1;
    layout.segments.push(codex);
    layout.natives.push(native("ns_x", "codex", Some("x-1")));
    let commit = plan_switch(&input(&chat, &layout, "claude")).unwrap();
    assert_eq!(
        commit.open_segment.unwrap().native,
        OpenNative::Existing("ns_c".into())
    );
    assert_eq!(commit.settings.model.as_deref(), Some("claude-old"));
    assert_eq!(commit.settings.fast, Some(true));
}

#[test]
fn a_missing_transcript_or_borrowed_row_is_never_the_return_target() {
    for (missing, borrowed) in [(true, false), (false, true)] {
        let chat = chat("codex");
        let mut layout = claude_only();
        layout.segments[0].closed_at = Some("t".into());
        layout.natives[0].transcript_missing = missing;
        layout.natives[0].borrowed_from_chat_id = borrowed.then(|| "parent".into());
        let mut codex = segment("s1", 1, "ns_x", SegmentKind::ProviderSwitch);
        codex.closed_at = None;
        codex.turn_count = 1;
        layout.segments.push(codex);
        layout.natives.push(native("ns_x", "codex", Some("x-1")));
        let commit = plan_switch(&input(&chat, &layout, "claude")).unwrap();
        assert!(matches!(
            commit.open_segment.unwrap().native,
            OpenNative::Fresh { .. }
        ));
    }
}

#[test]
fn the_request_overrides_the_returning_snapshot() {
    let chat = chat("claude");
    let layout = claude_only();
    let tuning = SessionTuning {
        ultracode: Some(Some(true)),
        ..Default::default()
    };
    let mut i = input(&chat, &layout, "codex");
    i.requested_model = Some("codex-pro");
    i.requested_tuning = Some(&tuning);
    i.target_auto_mode = true;
    let commit = plan_switch(&i).unwrap();
    assert_eq!(commit.settings.model.as_deref(), Some("codex-pro"));
    assert_eq!(commit.settings.ultracode, Some(true));
    // A target that supports auto keeps it.
    assert_eq!(commit.settings.permission_mode, Some(ExecutionMode::Auto));
}

#[test]
fn the_default_model_alias_normalizes_to_none() {
    let chat = chat("claude");
    let layout = claude_only();
    let mut i = input(&chat, &layout, "codex");
    i.requested_model = Some("default");
    i.default_model = None;
    assert_eq!(plan_switch(&i).unwrap().settings.model, None);
}
