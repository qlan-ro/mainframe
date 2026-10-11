use super::*;
use crate::chat_manager::ChatStore as _;
use crate::fork::PendingForkState;
use crate::test_support::{FakeDeps, test_chat};
use mainframe_services::quota::QuotaManager;
use mainframe_types::adapter::MessageUsage;

/// One event handler over the shared fake deps, with `cell` registered as the
/// live chat it drives.
pub(super) struct Harness {
    pub(super) deps: Arc<FakeDeps>,
    pub(super) shared: Arc<ChatShared>,
    pub(super) handler: Arc<EventHandler>,
}

impl Harness {
    pub(super) fn new(cell: Arc<Mutex<ActiveChat>>) -> Self {
        Self::build(FakeDeps::arc(), cell, Vec::new(), None)
    }

    pub(super) fn with_deps(deps: Arc<FakeDeps>, cell: Arc<Mutex<ActiveChat>>) -> Self {
        Self::build(deps, cell, Vec::new(), None)
    }

    /// `new`, with `refs` queued and the chat's messages already in `messages`.
    pub(super) fn with_queue(
        cell: Arc<Mutex<ActiveChat>>,
        refs: Vec<QueuedMessageRef>,
        messages: Arc<Mutex<MessageCache>>,
    ) -> Self {
        Self::build(FakeDeps::arc(), cell, refs, Some(messages))
    }

    pub(super) fn build(
        deps: Arc<FakeDeps>,
        cell: Arc<Mutex<ActiveChat>>,
        refs: Vec<QueuedMessageRef>,
        messages: Option<Arc<Mutex<MessageCache>>>,
    ) -> Self {
        let shared = match messages {
            Some(messages) => ChatShared::with_messages(deps.clone(), messages),
            None => ChatShared::new(deps.clone()),
        };
        let chat_id = cell.lock_recover().chat.id.clone();
        shared.active_chats.insert(chat_id, cell);
        shared.queued_refs.lock_recover().extend(refs);
        let offers = Arc::new(WorktreeOfferRegistry::new(shared.clone()));
        let handler = Arc::new(EventHandler::new(shared.clone(), offers));
        Self {
            deps,
            shared,
            handler,
        }
    }

    pub(super) fn messages(&self) -> Arc<Mutex<MessageCache>> {
        self.shared.messages.clone()
    }

    pub(super) fn permissions(&self) -> Arc<Mutex<PermissionManager>> {
        self.shared.permissions.clone()
    }

    pub(super) fn sink(&self, chat_id: &str) -> Arc<dyn SessionSink> {
        self.handler.build_sink(chat_id, None)
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
    cell_named("c1", process_state, turn_started_at)
}

/// A live cell for `chat_id`: the harness registers it under that id, so the
/// sink built for the same id finds it.
pub(super) fn cell_named(
    chat_id: &str,
    process_state: ProcessState,
    turn_started_at: Option<i64>,
) -> Arc<Mutex<ActiveChat>> {
    let mut chat = test_chat(chat_id);
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

// ── Session path ──────────────────────────────────

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

// ── Move-on-process acknowledgement ─────────────────────

// ── session-pushed provider quota (Codex account/rateLimits/updated) ──────
// Seam-3: a `sink.on_provider_quota` emission from a live session event must
// reach the real QuotaManager, sparse-merge (Push keeps the prior weekly
// window a partial blob omits), and fan out `provider.quota.updated`.

// ── onResult orphan-reconcile path ───────────────────────────────────────

// ── Retire pending forks on result ────────────────────
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

// ── Turn timing ────────────────────────────────────

// ── Background activity ────────────────────────────

include!("paths.rs");
include!("queues.rs");
include!("quotas.rs");
include!("results.rs");
include!("streaming.rs");

include!("storage_failures.rs");
