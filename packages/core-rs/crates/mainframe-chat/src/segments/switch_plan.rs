//! Pure switch planning: which segment closes (or is deleted), which native
//! session the target runs on, and the settings that carry over.

use mainframe_types::chat::{Chat, SessionTuning};
use mainframe_types::segment::{
    ClosedSnapshot, NativeSessionRecord, OpenNative, OpenSegment, PendingDeletion, SegmentKind,
    SegmentLayout, SegmentRecord, SwitchCommit, SwitchSettings,
};
use mainframe_types::settings::ExecutionMode;

use super::switch_rules::is_default_model;

pub struct SwitchPlanInput<'a> {
    pub chat: &'a Chat,
    pub layout: &'a SegmentLayout,
    pub target_adapter: &'a str,
    pub requested_model: Option<&'a str>,
    pub requested_tuning: Option<&'a SessionTuning>,
    /// `provider.<target>.defaultModel`.
    pub default_model: Option<&'a str>,
    pub target_auto_mode: bool,
    pub target_plan_mode: bool,
    pub now: &'a str,
    /// Fresh ids (injected so plans are deterministic in tests).
    pub new_segment_id: &'a str,
    pub new_native_id: &'a str,
}

/// The active segment never ran: no provider id, no turns, no handoff.
pub fn is_pending_empty(layout: &SegmentLayout, segment: &SegmentRecord) -> bool {
    let native_has_id = layout
        .native(&segment.native_session_ref)
        .is_some_and(|n| n.native_session_id.is_some());
    segment.ordinal > 0
        && segment.turn_count == 0
        && !native_has_id
        && layout.handoff_for(&segment.id).is_none()
}

/// The most recently used owned native session of `adapter` that can still
/// be resumed, ignoring `exclude` (a pending row being deleted).
pub fn best_candidate<'a>(
    layout: &'a SegmentLayout,
    adapter: &str,
    exclude: Option<&str>,
) -> Option<&'a NativeSessionRecord> {
    layout
        .segments
        .iter()
        .rev()
        .filter_map(|s| layout.native(&s.native_session_ref))
        .find(|n| {
            n.adapter_id == adapter
                && n.native_session_id.is_some()
                && n.borrowed_from_chat_id.is_none()
                && !n.transcript_missing
                && Some(n.id.as_str()) != exclude
        })
}

pub fn plan_switch(i: &SwitchPlanInput<'_>) -> Option<SwitchCommit> {
    let active = i.layout.active()?;
    let mut commit = SwitchCommit {
        chat_id: i.chat.id.clone(),
        now: i.now.to_string(),
        delete_pending: None,
        close_active: None,
        reactivate_segment_id: None,
        open_segment: None,
        settings: SwitchSettings::default(),
        borrow_pinned: None,
    };
    let candidate = if is_pending_empty(i.layout, active) {
        let shared = i
            .layout
            .segments
            .iter()
            .any(|s| s.id != active.id && s.native_session_ref == active.native_session_ref);
        commit.delete_pending = Some(PendingDeletion {
            segment_id: active.id.clone(),
            native_ref: (!shared).then(|| active.native_session_ref.clone()),
        });
        let candidate =
            best_candidate(i.layout, i.target_adapter, Some(&active.native_session_ref));
        let last = i.layout.segments.iter().rev().find(|s| s.id != active.id);
        if let (Some(last), Some(c)) = (last, candidate)
            && last.native_session_ref == c.id
        {
            commit.reactivate_segment_id = Some(last.id.clone());
        }
        candidate
    } else {
        commit.close_active = Some(snapshot(i.chat, active));
        best_candidate(i.layout, i.target_adapter, None)
    };
    if commit.reactivate_segment_id.is_none() {
        commit.open_segment = Some(open_segment(i, candidate));
    }
    commit.settings = settings(i, candidate);
    Some(commit)
}

fn snapshot(chat: &Chat, active: &SegmentRecord) -> ClosedSnapshot {
    ClosedSnapshot {
        segment_id: active.id.clone(),
        native_ref: active.native_session_ref.clone(),
        model: chat.model.clone().filter(|m| !is_default_model(Some(m))),
        tuning: Some(SessionTuning {
            effort: chat.effort,
            fast: chat.fast,
            ultracode: chat.ultracode,
            adaptive_thinking: chat.adaptive_thinking,
        }),
    }
}

fn open_segment(i: &SwitchPlanInput<'_>, candidate: Option<&NativeSessionRecord>) -> OpenSegment {
    let ordinal = i
        .layout
        .segments
        .iter()
        .map(|s| s.ordinal + 1)
        .max()
        .unwrap_or(0);
    OpenSegment {
        id: i.new_segment_id.to_string(),
        ordinal,
        kind: SegmentKind::ProviderSwitch,
        native: match candidate {
            Some(native) => OpenNative::Existing(native.id.clone()),
            None => OpenNative::Fresh {
                id: i.new_native_id.to_string(),
                adapter_id: i.target_adapter.to_string(),
            },
        },
    }
}

/// Model and tuning: the request's, else the returning session's snapshot,
/// else the defaults. Permission `auto` drops to `default` on a target that
/// lacks it, and is never restored on return: a switch never widens access.
fn settings(i: &SwitchPlanInput<'_>, returning: Option<&NativeSessionRecord>) -> SwitchSettings {
    let model = i
        .requested_model
        .map(str::to_string)
        .or_else(|| returning.and_then(|n| n.model.clone()))
        .or_else(|| i.default_model.map(str::to_string))
        .filter(|m| !is_default_model(Some(m)));
    let tuning = i
        .requested_tuning
        .cloned()
        .or_else(|| returning.and_then(|n| n.tuning.clone()))
        .unwrap_or_default();
    let permission_mode = match i.chat.permission_mode {
        Some(ExecutionMode::Auto) if !i.target_auto_mode => Some(ExecutionMode::Default),
        other => other,
    };
    SwitchSettings {
        adapter_id: i.target_adapter.to_string(),
        model,
        permission_mode,
        plan_mode: i.chat.plan_mode.unwrap_or(false) && i.target_plan_mode,
        effort: tuning.effort.flatten(),
        fast: tuning.fast.flatten(),
        ultracode: tuning.ultracode.flatten(),
        adaptive_thinking: tuning.adaptive_thinking.flatten(),
    }
}
