#![allow(clippy::too_many_lines, reason = "Test assertions and scenarios")]
//! Shared harness for the wiring-level transcript-presence tests. Drives the
//! production stack through `build_chat_manager` (see
//! `chat_background_activity.rs`, the structural template) rather than a
//! hand-built `ChatManagerDeps` fake.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

use mainframe_types::settings_kv::MemorySettings;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use mainframe_adapter_api::{Adapter, AdapterError, AdapterRegistry, AdapterSession, BoxFuture};
use mainframe_adapter_mock::ReplaySession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_chat::chat_manager::ChatManager;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_db::DatabaseManager;
use mainframe_server::chat_seams::{NoopLaunchStopper, NoopScopeTunnelStopper};
use mainframe_server::{Db, GitFactory, build_chat_manager};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::push::PushService;
use mainframe_services::quota::{QuotaManager, QuotaManagerDeps};
use mainframe_types::adapter::{AdapterCapabilities, AdapterModel, SessionOptions};
use mainframe_types::chat::Chat;
use mainframe_types::chat_patch::ChatPatch;
use mainframe_types::events::DaemonEvent;
use mainframe_types::transcript::TranscriptLocation;
use tempfile::TempDir;
use tokio::sync::broadcast;

/// Where the stub adapter reports a present transcript.
pub const PRESENT_AT: &str = "/stub/projects/-repo--claude-worktrees-wt/sess-1.jsonl";

/// What the stub adapter's `locate_transcript` lookup should report.
#[derive(Clone, Copy)]
pub enum PredicateOutcome {
    Present,
    Absent,
    Error,
}

/// A minimal adapter whose only interesting behaviour is the transcript lookup;
/// every other method mirrors the unreachable-shaped stub in
/// `routes/session_transcripts.rs`.
pub struct StubAdapter {
    adapter_id: String,
    outcome: PredicateOutcome,
    pub calls: AtomicUsize,
}

impl StubAdapter {
    pub fn new(adapter_id: &str, outcome: PredicateOutcome) -> Arc<Self> {
        Arc::new(Self {
            adapter_id: adapter_id.to_string(),
            outcome,
            calls: AtomicUsize::new(0),
        })
    }
}

impl Adapter for StubAdapter {
    fn id(&self) -> &str {
        &self.adapter_id
    }
    fn name(&self) -> &str {
        &self.adapter_id
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: false,
            fork: false,
        }
    }
    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(true) })
    }
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        Box::pin(async { Ok(None) })
    }
    fn catalog(&self) -> Vec<AdapterModel> {
        Vec::new()
    }
    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession> {
        Arc::new(ReplaySession::new(options, Vec::new()))
    }
    fn kill_all(&self) {}

    fn locate_transcript(
        &self,
        _session_id: String,
        _project_path: String,
        _session_file_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<TranscriptLocation>, AdapterError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let outcome = self.outcome;
        Box::pin(async move {
            match outcome {
                PredicateOutcome::Present => {
                    Ok(Some(TranscriptLocation::Present(PRESENT_AT.to_string())))
                }
                PredicateOutcome::Absent => Ok(Some(TranscriptLocation::Missing)),
                PredicateOutcome::Error => {
                    Err(AdapterError::Message("stub predicate failed".to_string()))
                }
            }
        })
    }
}

pub struct Harness {
    pub manager: Arc<ChatManager>,
    pub db: Db,
    pub broadcast: broadcast::Sender<DaemonEvent>,
    pub project_id: String,
    pub chat_id: String,
    _data_dir: TempDir,
}

/// Builds the harness. `adapter` is registered under its own id when present;
/// otherwise the seeded chat points at `"unregistered-adapter"`, an id the
/// registry never knows about. `seed_missing` seeds the persisted
/// `transcript_missing` flag before any reconciliation runs — reconciliation
/// skips a chat with no session id, so every case seeds `vendor_session_id`.
pub fn harness(adapter: Option<Arc<StubAdapter>>, seed_missing: Option<bool>) -> Harness {
    let data_dir = tempfile::tempdir().unwrap();
    let db = Db::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap();
    let (broadcast, _keepalive) = broadcast::channel::<DaemonEvent>(64);
    let registry = Arc::new(AdapterRegistry::new());
    let adapter_id = match &adapter {
        Some(adapter) => {
            registry.register(adapter.clone());
            adapter.id().to_string()
        }
        None => "unregistered-adapter".to_string(),
    };
    let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings: Arc::new(MemorySettings::default()),
        emit_event: Box::new(|_| {}),
        now: None,
    }));

    let path = data_dir.path().to_string_lossy().into_owned();
    let project = db
        .call_blocking(move |d| d.projects.create(&path, None))
        .unwrap();
    let project_id_for_chat = project.id.clone();
    let adapter_id_for_chat = adapter_id.clone();
    let chat = db
        .call_blocking(move |d| {
            d.chats.create(&mainframe_types::chat::NewChat {
                project_id: project_id_for_chat,
                adapter_id: adapter_id_for_chat,
                ..Default::default()
            })
        })
        .unwrap();

    let chat_id_for_seed = chat.id.clone();
    db.call_blocking(move |d| {
        d.chats.update(
            &chat_id_for_seed,
            &ChatPatch {
                vendor_session_id: Some("sess-1".to_string()),
                transcript_missing: seed_missing,
                ..Default::default()
            },
        )
    })
    .unwrap();

    let manager = build_chat_manager(mainframe_server::ChatManagerParams {
        db: db.clone(),
        adapters: registry,
        background_tasks: Arc::new(BackgroundTaskTracker::new()),
        attachments: Arc::new(AttachmentStore::new(data_dir.path().join("attachments"))),
        push: Arc::new(PushService::new()),
        git: GitFactory,
        broadcast: broadcast.clone(),
        launch: Arc::new(NoopLaunchStopper),
        scope_tunnels: Arc::new(NoopScopeTunnelStopper),
        quota,
        claude_workflows: Arc::new(ClaudeWorkflowStore::new()),
        chat_surface: None,
        data_dir: data_dir.path().to_path_buf(),
    });

    Harness {
        manager,
        db,
        broadcast,
        project_id: project.id,
        chat_id: chat.id,
        _data_dir: data_dir,
    }
}

/// Reads the persisted `transcript_missing` flag back from the DB, bypassing
/// `ChatManager` so assertions don't depend on its own read path.
pub fn persisted_missing(h: &Harness) -> Option<bool> {
    let chat_id = h.chat_id.clone();
    h.db.call_blocking(move |d| d.chats.get(&chat_id))
        .unwrap()
        .and_then(|chat| chat.transcript_missing)
}

/// Reads the persisted `session_file_path` back from the DB.
pub fn persisted_session_file_path(h: &Harness) -> Option<String> {
    let chat_id = h.chat_id.clone();
    h.db.call_blocking(move |d| d.chats.get(&chat_id))
        .unwrap()
        .and_then(|chat| chat.session_file_path)
}

/// Drains `rx` for the next `chat.updated` broadcast, or `None` once `timeout`
/// elapses — used both to assert an emission and to assert its absence with a
/// short timeout.
pub async fn next_chat_updated(
    rx: &mut broadcast::Receiver<DaemonEvent>,
    timeout: Duration,
) -> Option<Chat> {
    tokio::time::timeout(timeout, async {
        loop {
            match rx.recv().await.ok()? {
                DaemonEvent::ChatUpdated { chat, .. } => return Some(chat),
                _ => continue,
            }
        }
    })
    .await
    .ok()
    .flatten()
}
