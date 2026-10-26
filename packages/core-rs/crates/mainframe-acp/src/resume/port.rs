use super::{BoxFuture, ResumeReplay, ResumeSnapshot};
use mainframe_types::acp::jsonrpc::JsonRpcResponse;
use mainframe_types::adapter::ControlRequest;
use mainframe_types::display::{DisplayMessage, StreamingLeafKind};

pub type SnapshotReader<'a> = Box<
    dyn FnOnce(
            &[DisplayMessage],
            Option<StreamingLeafKind>,
            Option<ControlRequest>,
        ) -> (JsonRpcResponse, ResumeReplay)
        + Send
        + 'a,
>;

pub trait ResumePort: Send + Sync {
    fn resume_snapshot<'a>(&'a self, session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot>;
    fn is_running(&self, session_id: &str) -> bool;

    /// Wall-clock epoch ms at which the session's current turn started, as the
    /// daemon recorded it; `None` when idle or unknown. Read only while
    /// `is_running`, so every connection's replay carries the same value.
    fn turn_started_at_ms(&self, _session_id: &str) -> Option<i64> {
        None
    }

    fn read_snapshot<'a>(
        &'a self,
        session_id: &'a str,
        read: SnapshotReader<'a>,
    ) -> BoxFuture<'a, (JsonRpcResponse, ResumeReplay)> {
        Box::pin(async move {
            let snapshot = self.resume_snapshot(session_id).await;
            read(&snapshot.messages, snapshot.streaming, snapshot.pending)
        })
    }
}
