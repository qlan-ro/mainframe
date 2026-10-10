use super::*;
use crate::test_support::test_chat;
use mainframe_services::quota::{IngestMode, QuotaManager};
use mainframe_types::adapter::MessageUsage;

pub(super) struct FakeDeps {
    cell: Arc<Mutex<ActiveChat>>,
    events: Mutex<Vec<DaemonEvent>>,
    refs: Mutex<Vec<QueuedMessageRef>>,
    updates: Mutex<Vec<EventChatUpdate>>,
    quota: Option<Arc<QuotaManager>>,
    /// `db.chats.pendingFork` for "c1" (todo #343); `None` for every test
    /// outside the retire-on-result coverage.
    pending_fork: Mutex<Option<PendingForkState>>,
    project_path: Mutex<Option<String>>,
}

impl FakeDeps {
    pub(super) fn new(cell: Arc<Mutex<ActiveChat>>, refs: Vec<QueuedMessageRef>) -> Arc<Self> {
        Arc::new(Self {
            cell,
            events: Mutex::new(Vec::new()),
            refs: Mutex::new(refs),
            updates: Mutex::new(Vec::new()),
            quota: None,
            pending_fork: Mutex::new(None),
            project_path: Mutex::new(None),
        })
    }
    fn with_quota(cell: Arc<Mutex<ActiveChat>>, quota: Arc<QuotaManager>) -> Arc<Self> {
        Arc::new(Self {
            cell,
            events: Mutex::new(Vec::new()),
            refs: Mutex::new(Vec::new()),
            updates: Mutex::new(Vec::new()),
            quota: Some(quota),
            pending_fork: Mutex::new(None),
            project_path: Mutex::new(None),
        })
    }
    fn set_pending_fork(&self, pending: PendingForkState) {
        *self.pending_fork.lock().unwrap() = Some(pending);
    }
}

impl EventHandlerDeps for FakeDeps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        Some(self.cell.clone())
    }
    fn emit_event(&self, event: DaemonEvent) {
        self.events.lock().unwrap().push(event);
    }
    fn get_tool_categories(&self, _chat_id: &str) -> Option<ToolCategories> {
        None
    }
    fn on_queued_processed(&self, _chat_id: &str, uuid: &str) {
        self.refs.lock().unwrap().retain(|r| r.uuid != uuid);
    }
    fn on_queued_cleared(&self, _chat_id: &str) {}
    fn get_queued_refs(&self, _chat_id: &str) -> Vec<QueuedMessageRef> {
        self.refs.lock().unwrap().clone()
    }
    fn display_projector(&self) -> Box<dyn DisplayProjector> {
        Box::new(FullRebuildProjector::new(|_raw, _overlay, _categories| {
            Vec::new()
        }))
    }
    fn strip_command_tags(&self, text: &str) -> String {
        text.to_string()
    }
    fn chats_update(&self, _chat_id: &str, patch: &EventChatUpdate) {
        self.updates.lock().unwrap().push(patch.clone());
    }
    fn projects_get_path(&self, _project_id: &str) -> Option<String> {
        self.project_path.lock().unwrap().clone()
    }
    fn initial_transcript_path(
        &self,
        adapter_id: &str,
        session_id: &str,
        cwd: &str,
    ) -> Option<String> {
        (adapter_id == "claude").then(|| compute_session_file_path(cwd, session_id))
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
        true
    }
    fn on_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
        // Mirror DaemonChatDeps: session-pushed quota sparse-merges (Push).
        if let Some(q) = &self.quota {
            q.ingest(adapter_id, quota, IngestMode::Push);
        }
    }
    /// Empty on purpose: BgDeps below covers on_exit's tracker_end_all_running wiring.
    fn tracker_end_all_running(&self, _chat_id: &str) {}
    /// Empty on purpose: chat_deps.rs's workflow_runs_stop_all_delegates_... test covers the wiring.
    fn workflow_runs_stop_all(&self, _chat_id: &str) {}
    fn get_pending_fork(&self, _chat_id: &str) -> Option<PendingForkState> {
        self.pending_fork.lock().unwrap().clone()
    }
    fn clear_pending_fork(&self, _chat_id: &str) {
        *self.pending_fork.lock().unwrap() = None;
    }
}

fn umsg(id: &str, meta: Option<HashMap<String, serde_json::Value>>) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::User,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: id.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: now_iso8601(),
        metadata: meta,
    }
}

fn queued_meta(uuid: &str) -> HashMap<String, serde_json::Value> {
    let mut m = HashMap::new();
    m.insert("queued".to_string(), serde_json::json!(true));
    m.insert("uuid".to_string(), serde_json::json!(uuid));
    m
}

pub(super) fn cell(
    process_state: ProcessState,
    turn_started_at: Option<i64>,
) -> Arc<Mutex<ActiveChat>> {
    let mut chat = test_chat("c1");
    chat.process_state = Some(Some(process_state));
    let mut active = ActiveChat::new(chat, None);
    active.turn_started_at = turn_started_at;
    Arc::new(Mutex::new(active))
}

fn ids(messages: &Arc<Mutex<MessageCache>>) -> Vec<String> {
    messages
        .lock()
        .unwrap()
        .get("c1")
        .map(|v| v.iter().map(|m| m.id.clone()).collect())
        .unwrap_or_default()
}

// ── event-handler-session-path.test.ts ──────────────────────────────────

#[derive(Default)]
struct QueueSurface {
    snapshots: Mutex<Vec<Vec<QueuedMessageRef>>>,
}

impl QueueSurface {
    fn snapshots(&self) -> Vec<Vec<QueuedMessageRef>> {
        self.snapshots.lock().unwrap().clone()
    }
}

impl ChatSurface for QueueSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        if let ChatSurfaceEvent::QueueChanged { refs, .. } = event {
            self.snapshots.lock().unwrap().push(refs);
        }
    }
}

// ── event-handler-move-on-process.test.ts (ack path) ─────────────────────

// ── session-pushed provider quota (Codex account/rateLimits/updated) ──────
// Seam-3: a `sink.on_provider_quota` emission from a live session event must
// reach the real QuotaManager, sparse-merge (Push keeps the prior weekly
// window a partial blob omits), and fan out `provider.quota.updated`.

// ── onResult orphan-reconcile path ───────────────────────────────────────

// ── retire-on-result (todo #343 Group 3, plan item 5) ────────────────────
fn result(subtype: &str, is_error: Option<bool>) -> SessionResult {
    SessionResult {
        total_cost_usd: Some(0.0),
        usage: None,
        context_tokens: None,
        subtype: Some(subtype.to_string()),
        result: None,
        is_error,
    }
}

// ── event-handler-turn-timing.test.ts ────────────────────────────────────

// ── event-handler-background-activity.test.ts ────────────────────────────

include!("paths.rs");
include!("queues.rs");
include!("quotas.rs");
include!("results.rs");
include!("streaming.rs");
