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

/// Reads the display list in place, under the chat's cache lock.
pub type MessageReader<'a> = Box<dyn FnOnce(&[DisplayMessage]) + Send + 'a>;

pub trait ResumePort: Send + Sync {
    fn resume_snapshot<'a>(&'a self, session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot>;
    fn is_running(&self, session_id: &str) -> bool;

    /// Wall-clock epoch ms at which the session's current turn started, as the
    /// daemon recorded it; `None` when idle or unknown. Read only while
    /// `is_running`, so every connection's replay carries the same value.
    fn turn_started_at_ms(&self, _session_id: &str) -> Option<i64> {
        None
    }

    /// Lend the chat's display list to `read` without cloning it. The default
    /// goes through `resume_snapshot`, which owns a copy; a port that holds
    /// the list should override it.
    fn read_messages<'a>(
        &'a self,
        session_id: &'a str,
        read: MessageReader<'a>,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let snapshot = self.resume_snapshot(session_id).await;
            read(&snapshot.messages);
        })
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

/// Run `read` over the chat's display list and return its result, or `None`
/// if the port never ran it or `read` panicked. The closure runs while the
/// list is borrowed, typically under the chat cache lock shared by every
/// chat's live emissions, so keep it to a bounded page. A panic is contained
/// here so it cannot unwind through the port while it holds that lock or a
/// pending projection delta.
pub async fn with_messages<T: Send>(
    port: &dyn ResumePort,
    session_id: &str,
    read: impl FnOnce(&[DisplayMessage]) -> T + Send,
) -> Option<T> {
    let mut out = None;
    port.read_messages(
        session_id,
        Box::new(|messages| {
            out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| read(messages))).ok();
        }),
    )
    .await;
    out
}
