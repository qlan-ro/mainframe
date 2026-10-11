use mainframe_chat::chat_surface::{ChatSurface, ChatSurfaceEvent};
use mainframe_chat::{event_handler::EventHandler, message_cache::MessageCache};
use mainframe_types::display::{DisplayMessage, StreamingLeafKind, ToolCategories};
use std::sync::{Arc, Mutex};

pub fn handler(cache: Arc<Mutex<MessageCache>>, subagent: &str) -> EventHandler {
    mainframe_chat::test_support::presentation_handler(
        cache,
        || Box::new(mainframe_adapter_claude::messages::incremental::IncrementalProjector::new()),
        Some(ToolCategories {
            subagent: std::collections::HashSet::from([subagent.into()]),
            hidden: Default::default(),
            explore: Default::default(),
            progress: Default::default(),
        }),
    )
}

/// Records every `DisplayRevision`'s `(messages, streaming)` pair, in order.
#[derive(Default)]
pub struct RevisionSurface {
    revisions: Mutex<Vec<(Vec<DisplayMessage>, Option<StreamingLeafKind>)>>,
}

impl RevisionSurface {
    pub fn revisions(&self) -> Vec<(Vec<DisplayMessage>, Option<StreamingLeafKind>)> {
        self.revisions.lock().unwrap().clone()
    }
}

impl ChatSurface for RevisionSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        if let ChatSurfaceEvent::DisplayRevision {
            delta, streaming, ..
        } = event
        {
            let messages = delta.snapshot.materialize();
            self.revisions.lock().unwrap().push((messages, streaming));
        }
    }
}

pub struct Snapshot(pub Vec<DisplayMessage>, pub Option<StreamingLeafKind>);
impl mainframe_acp::resume::ResumePort for Snapshot {
    fn resume_snapshot<'a>(
        &'a self,
        _: &'a str,
    ) -> mainframe_acp::resume::BoxFuture<'a, mainframe_acp::resume::ResumeSnapshot> {
        Box::pin(async move {
            mainframe_acp::resume::ResumeSnapshot {
                messages: self.0.clone(),
                streaming: self.1,
                pending: None,
            }
        })
    }
    fn is_running(&self, _: &str) -> bool {
        self.1.is_some()
    }
}
pub async fn replay(
    snapshot: &Snapshot,
    cursor: serde_json::Value,
) -> mainframe_acp::resume::ResumeReplay {
    let request=serde_json::from_value(serde_json::json!({"jsonrpc":"2.0","id":1,"method":"session/resume","params":{"sessionId":"chat","cwd":"/tmp","replayFrom":cursor}})).unwrap();
    let (_, replay) = mainframe_acp::resume::dispatch_resume(request, snapshot, None).await;
    replay
}
