//! `SegmentStore` over the segment and handoff repositories, through the same
//! sync-DB bridge (`Db::call_blocking`) as every other `DaemonChatDeps` read.
//! A child module of `chat_deps` so it can reach the private `db` handle.

use mainframe_chat::segments::SegmentStore;
use mainframe_types::segment::{
    HandoffRecord, HandoffStatus, SegmentLayout, SegmentResultDelta, SwitchCommit,
};

use super::DaemonChatDeps;

impl SegmentStore for DaemonChatDeps {
    fn layout(&self, chat_id: &str) -> Option<SegmentLayout> {
        let id = chat_id.to_string();
        match self.db.call_blocking(move |d| d.segments.layout(&id)) {
            Ok(layout) => Some(layout),
            Err(err) => {
                tracing::warn!(%err, chat_id, "segment layout read failed");
                None
            }
        }
    }

    fn commit_switch(&self, commit: &SwitchCommit) -> Result<SegmentLayout, String> {
        let commit = commit.clone();
        self.db
            .call_blocking(move |d| d.segments.commit_switch(&commit))
            .map_err(|err| err.to_string())
    }

    fn replace_active_native(&self, chat_id: &str) -> Result<SegmentLayout, String> {
        let id = chat_id.to_string();
        self.db
            .call_blocking(move |d| d.segments.replace_active_native(&id))
            .map_err(|err| err.to_string())
    }

    fn insert_pending_handoff(
        &self,
        record: &HandoffRecord,
        start_marker: &str,
    ) -> Result<(), String> {
        let record = record.clone();
        let marker = start_marker.to_string();
        self.db
            .call_blocking(move |d| d.handoffs.insert_pending(&record, &marker))
            .map_err(|err| err.to_string())
    }

    fn set_handoff_status(&self, handoff_id: &str, status: HandoffStatus) -> bool {
        let id = handoff_id.to_string();
        match self
            .db
            .call_blocking(move |d| d.handoffs.set_status(&id, status))
        {
            Ok(changed) => changed,
            Err(err) => {
                tracing::warn!(%err, handoff_id, "handoff status write failed");
                false
            }
        }
    }

    fn add_result(&self, chat_id: &str, delta: &SegmentResultDelta) {
        let id = chat_id.to_string();
        let delta = delta.clone();
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.segments.add_result(&id, &delta))
        {
            tracing::warn!(%err, chat_id, "segment counters write failed");
        }
    }

    fn has_native_id(&self, chat_id: &str) -> bool {
        let id = chat_id.to_string();
        match self
            .db
            .call_blocking(move |d| d.segments.has_native_id(&id))
        {
            Ok(has) => has,
            Err(err) => {
                tracing::warn!(%err, chat_id, "native session read failed");
                false
            }
        }
    }
}
