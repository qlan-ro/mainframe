use mainframe_adapter_claude::messages::display_pipeline::prepare_messages_for_client;
use mainframe_chat::chat_surface::{ChatSurface, ChatSurfaceEvent};
use mainframe_chat::event_handler::{EventChatUpdate, EventHandlerDeps};
use mainframe_chat::types::ActiveChat;
use mainframe_types::adapter::DetectedPr;
use mainframe_types::chat::{ChatMessage, QueuedMessageRef, TodoItem};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::display::{DisplayMessage, StreamingLeafKind, ToolCategories};
use mainframe_types::events::DaemonEvent;
use std::sync::{Arc, Mutex};
pub struct Deps;

impl EventHandlerDeps for Deps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        None
    }
    fn emit_event(&self, _event: DaemonEvent) {}
    fn get_tool_categories(&self, _chat_id: &str) -> Option<ToolCategories> {
        Some(ToolCategories {
            subagent: std::collections::HashSet::from(["Task".into()]),
            hidden: Default::default(),
            explore: Default::default(),
            progress: Default::default(),
        })
    }
    fn on_queued_processed(&self, _chat_id: &str, _uuid: &str) {}
    fn on_queued_cleared(&self, _chat_id: &str) {}
    fn get_queued_refs(&self, _chat_id: &str) -> Vec<QueuedMessageRef> {
        Vec::new()
    }
    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        prepare_messages_for_client(raw, categories)
    }
    fn strip_command_tags(&self, text: &str) -> String {
        text.to_string()
    }
    fn chats_update(&self, _chat_id: &str, _patch: &EventChatUpdate) {}
    fn projects_get_path(&self, _project_id: &str) -> Option<String> {
        None
    }
    fn add_plan_file(&self, _chat_id: &str, _file_path: &str) -> bool {
        false
    }
    fn add_skill_file(&self, _chat_id: &str, _entry: &SkillFileEntry) -> bool {
        false
    }
    fn update_todos(&self, _chat_id: &str, _todos: &[TodoItem]) {}
    fn add_detected_prs(&self, _chat_id: &str, _prs: &[DetectedPr]) -> Vec<DetectedPr> {
        Vec::new()
    }
    fn should_notify_permission(&self, _tool_name: Option<&str>) -> bool {
        false
    }
    fn notify_task_complete(&self) -> bool {
        false
    }
    fn notify_session_error(&self) -> bool {
        false
    }
    fn notify_attention_request(&self) -> bool {
        false
    }
    fn tracker_end_all_running(&self, _chat_id: &str) {}
    fn workflow_runs_stop_all(&self, _chat_id: &str) {}
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
            messages,
            streaming,
            ..
        } = event
        {
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
