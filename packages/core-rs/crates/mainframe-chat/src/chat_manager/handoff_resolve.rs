//! Resolving a segment's earlier handoff from the target transcript: the
//! marker is either there (delivered) or not (superseded, rebuild). Also the
//! resumability check a delta handoff depends on.
use super::*;

use mainframe_types::segment::{HandoffStatus, NativeSessionRecord, SegmentLayout, SegmentRecord};
use mainframe_types::transcript::TranscriptLocation;

use crate::handoff::leading_marker_segment;
use crate::segments::SegmentStore;
use crate::segments::divider::refresh_divider;

impl ChatManager {
    /// `true` when the segment already has its handoff in the transcript
    /// (delivered, or a pending row whose marker the transcript holds).
    pub(super) async fn resolve_live_handoff(
        &self,
        store: &dyn SegmentStore,
        chat_id: &str,
        layout: &SegmentLayout,
        active: &SegmentRecord,
    ) -> bool {
        let Some(live) = layout.handoff_for(&active.id) else {
            return false;
        };
        if live.status == HandoffStatus::Delivered {
            return true;
        }
        let native = layout.native(&active.native_session_ref);
        let marker = active.start_marker.as_deref().unwrap_or(&active.id);
        let delivered = match native {
            Some(n) if n.native_session_id.is_some() => {
                self.transcript_has_marker(chat_id, n, marker).await
            }
            _ => false,
        };
        let status = if delivered {
            HandoffStatus::Delivered
        } else {
            HandoffStatus::Superseded
        };
        store.set_handoff_status(&live.id, status);
        let name_of = |id: &str| self.deps.adapter_fork_info(id).name;
        if refresh_divider(&self.messages, store, chat_id, &active.id, &name_of) {
            self.event_handler.emit_display(chat_id);
        }
        delivered
    }

    async fn transcript_has_marker(
        &self,
        chat_id: &str,
        native: &NativeSessionRecord,
        marker: &str,
    ) -> bool {
        let Some(chat) = self.get_chat(chat_id) else {
            return false;
        };
        let Some(cwd) = self.get_effective_path(chat_id) else {
            return false;
        };
        let options = SessionOptions {
            project_path: cwd,
            chat_id: native.native_session_id.clone(),
            mainframe_chat_id: chat.id.clone(),
            session_file_path: native.session_file_path.clone(),
            fork_source: None,
        };
        let Some(session) = self.deps.create_session(&native.adapter_id, options) else {
            return false;
        };
        match session.load_history().await {
            Ok(history) => history.iter().any(|m| {
                m.r#type == ChatMessageType::User
                    && m.content.iter().any(|b| match b {
                        MessageContent::Leaf(LeafContent::Text { text, .. }) => {
                            leading_marker_segment(text) == Some(marker)
                        }
                        _ => false,
                    })
            }),
            Err(err) => {
                tracing::warn!(
                    ?err,
                    chat_id,
                    "handoff: could not read the target transcript"
                );
                false
            }
        }
    }

    pub(super) async fn transcript_present(
        &self,
        chat: &Chat,
        native: &NativeSessionRecord,
    ) -> bool {
        let (Some(id), Some(project_path)) =
            (&native.native_session_id, self.get_effective_path(&chat.id))
        else {
            return false;
        };
        let located = self
            .deps
            .locate_transcript(
                &native.adapter_id,
                id,
                &project_path,
                native.session_file_path.as_deref(),
            )
            .await;
        // An undeterminable location lets the resume try; only a known-missing
        // transcript forces a fresh session.
        !matches!(located, Some(TranscriptLocation::Missing))
    }
}
