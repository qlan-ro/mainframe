use super::*;
pub struct ActiveTask {
    pub task_type: String,
    pub command: Option<String>,
}
pub(super) struct SharedSurface {
    pub(super) pid: AtomicU32,
    pub(super) status: AtomicU8,
    pub(super) last_activity_ms: AtomicI64,
    pub(super) endpoint: AtomicBool,
}

pub(super) fn status_to_u8(s: AdapterProcessStatus) -> u8 {
    match s {
        AdapterProcessStatus::Starting => 0,
        AdapterProcessStatus::Ready => 1,
        AdapterProcessStatus::Running => 2,
        AdapterProcessStatus::Stopped => 3,
        AdapterProcessStatus::Error => 4,
    }
}
pub(super) fn u8_to_status(v: u8) -> AdapterProcessStatus {
    match v {
        1 => AdapterProcessStatus::Ready,
        2 => AdapterProcessStatus::Running,
        3 => AdapterProcessStatus::Stopped,
        4 => AdapterProcessStatus::Error,
        _ => AdapterProcessStatus::Starting,
    }
}

pub(super) use mainframe_types::time::now_ms;
pub struct ClaudeSessionState {
    pub(crate) presentation: crate::transcript_presentation::ClaudePresentation,
    pub chat_id: String,
    pub mainframe_chat_id: String,
    pub real_project_path: String,
    pub buffer: String,
    pub last_assistant_usage: Option<MessageUsage>,
    pub child: Option<ChildHandle>,
    pub active_tasks: HashMap<String, ActiveTask>,
    pub interrupt_timer: Option<tokio::task::JoinHandle<()>>,
    pub skill_path_cache: HashMap<String, String>,
    pub task_v2_events: Vec<Value>,
    pub task_events: ClaudeTaskEvents,
    pub partial: crate::partial_stream::PartialMessageState,
    pub seen_api_message_ids: std::collections::HashSet<String>,
}
