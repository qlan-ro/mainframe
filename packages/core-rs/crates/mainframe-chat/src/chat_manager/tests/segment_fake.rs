//! An in-memory `SegmentStore` for the chat-layer segment tests (provider
//! switch, forks of multi-segment chats): it applies switch commits the way
//! the segment repository does, closely enough for the chat layer's view.

use mainframe_types::segment::{
    HandoffRecord, HandoffStatus, NativeSessionRecord, OpenNative, SegmentKind, SegmentLayout,
    SegmentRecord, SegmentResultDelta, SwitchCommit,
};

use super::*;
use crate::segments::SegmentStore;

#[derive(Default)]
pub(super) struct FakeStore {
    pub(super) layout: Mutex<SegmentLayout>,
    pub(super) commits: Mutex<Vec<SwitchCommit>>,
    pub(super) results: Mutex<Vec<SegmentResultDelta>>,
}

impl FakeStore {
    pub(super) fn with_layout(layout: SegmentLayout) -> Arc<Self> {
        Arc::new(Self {
            layout: Mutex::new(layout),
            ..Default::default()
        })
    }

    fn apply(&self, c: &SwitchCommit) {
        let mut l = self.layout.lock().unwrap();
        if let Some(conversion) = &c.borrow_pinned {
            crate::segments::fork_borrow::apply_to_layout(&mut l, conversion);
        }
        if let Some(p) = &c.delete_pending {
            l.segments.retain(|s| s.id != p.segment_id);
        }
        for s in &mut l.segments {
            if c.close_active
                .as_ref()
                .is_some_and(|x| x.segment_id == s.id)
            {
                s.closed_at = Some(c.now.clone());
            }
            if c.reactivate_segment_id.as_deref() == Some(s.id.as_str()) {
                s.closed_at = None;
            }
        }
        if let Some(open) = &c.open_segment {
            let native_ref = match &open.native {
                OpenNative::Existing(id) => id.clone(),
                OpenNative::Fresh { id, adapter_id } => {
                    l.natives.push(native(id, adapter_id, None));
                    id.clone()
                }
            };
            let mut seg = segment(&open.id, open.ordinal, &native_ref, open.kind);
            seg.closed_at = None;
            l.segments.push(seg);
        }
    }
}

impl SegmentStore for FakeStore {
    fn layout(&self, _chat_id: &str) -> Option<SegmentLayout> {
        Some(self.layout.lock().unwrap().clone())
    }
    fn commit_switch(&self, commit: &SwitchCommit) -> Result<SegmentLayout, String> {
        self.commits.lock().unwrap().push(commit.clone());
        self.apply(commit);
        Ok(self.layout.lock().unwrap().clone())
    }
    fn replace_active_native(&self, _chat_id: &str) -> Result<SegmentLayout, String> {
        Err("not expected in these tests".into())
    }
    fn insert_pending_handoff(&self, record: &HandoffRecord, marker: &str) -> Result<(), String> {
        let mut l = self.layout.lock().unwrap();
        l.handoffs
            .retain(|h| h.target_segment_id != record.target_segment_id);
        l.handoffs.push(record.clone());
        if let Some(s) = l
            .segments
            .iter_mut()
            .find(|s| s.id == record.target_segment_id)
        {
            s.start_marker.get_or_insert_with(|| marker.to_string());
        }
        Ok(())
    }
    fn set_handoff_status(&self, handoff_id: &str, status: HandoffStatus) -> bool {
        let mut l = self.layout.lock().unwrap();
        let Some(h) = l.handoffs.iter_mut().find(|h| h.id == handoff_id) else {
            return false;
        };
        h.status = status;
        true
    }
    fn add_result(&self, _chat_id: &str, delta: &SegmentResultDelta) {
        self.results.lock().unwrap().push(delta.clone());
    }
    fn set_session_file_path(&self, native_ref: &str, path: &str) {
        let mut l = self.layout.lock().unwrap();
        if let Some(n) = l.natives.iter_mut().find(|n| n.id == native_ref) {
            n.session_file_path = Some(path.to_string());
        }
    }
    fn has_native_id(&self, _chat_id: &str) -> bool {
        let l = self.layout.lock().unwrap();
        l.natives.iter().any(|n| n.native_session_id.is_some())
    }
}

pub(super) fn native(id: &str, adapter: &str, native_id: Option<&str>) -> NativeSessionRecord {
    NativeSessionRecord {
        id: id.into(),
        adapter_id: adapter.into(),
        native_session_id: native_id.map(str::to_string),
        ..Default::default()
    }
}

pub(super) fn segment(id: &str, ordinal: u32, native: &str, kind: SegmentKind) -> SegmentRecord {
    SegmentRecord {
        id: id.into(),
        ordinal,
        native_session_ref: native.into(),
        kind,
        closed_at: Some("t".into()),
        created_at: "2026-10-06T00:00:00Z".into(),
        ..Default::default()
    }
}
