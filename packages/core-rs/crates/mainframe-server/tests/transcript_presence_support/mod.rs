//! Shared harness for #289's wiring-level transcript-presence tests. Drives
//! the production stack through `build_chat_manager` (see
//! `chat_background_activity.rs`, #273's structural template) rather than a
//! hand-built `ChatManagerDeps` fake.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
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
use mainframe_db::chats::ChatUpdate;
use mainframe_server::chat_seams::{NoopLaunchStopper, NoopScopeTunnelStopper};
use mainframe_server::{Db, GitFactory, build_chat_manager};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::push::PushService;
use mainframe_services::quota::{QuotaManager, QuotaManagerDeps, QuotaSettingsStore};
use mainframe_types::adapter::{AdapterCapabilities, AdapterModel, SessionOptions};
use mainframe_types::chat::Chat;
use mainframe_types::events::DaemonEvent;
use tempfile::TempDir;
use tokio::sync::broadcast;

/// What the stub adapter's `is_transcript_present` predicate should report.
#[derive(Clone, Copy)]
pub enum PredicateOutcome {
    Present,
    Absent,
    Error,
}

/// A minimal adapter whose only interesting behaviour is the transcript-presence
/// predicate; every other method mirrors the unreachable-shaped stub in
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
        AdapterCapabilities { plan_mode: false }
    }
    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(true) })
    }
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        Box::pin(async { Ok(None) })
    }
    fn list_models(&self) -> BoxFuture<'_, Result<Vec<AdapterModel>, AdapterError>> {
        Box::pin(async { Ok(vec![]) })
    }
    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession> {
        Arc::new(ReplaySession::new(options, Vec::new()))
    }
    fn kill_all(&self) {}

    fn is_transcript_present(
        &self,
        _session_id: String,
        _project_path: String,
        _session_file_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<bool>, AdapterError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let outcome = self.outcome;
        Box::pin(async move {
            match outcome {
                PredicateOutcome::Present => Ok(Some(true)),
                PredicateOutcome::Absent => Ok(Some(false)),
                PredicateOutcome::Error => {
                    Err(AdapterError::Message("stub predicate failed".to_string()))
                }
            }
        })
    }
}

struct NoopQuotaSettings;

impl QuotaSettingsStore for NoopQuotaSettings {
    fn get(&self, _category: &str, _key: &str) -> Option<String> {
        None
    }
    fn get_by_category(&self, _category: &str) -> HashMap<String, String> {
        HashMap::new()
    }
    fn set(&self, _category: &str, _key: &str, _value: &str) {}
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
/// skips a chat with no session id, so every case seeds `claude_session_id`.
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
        settings: Box::new(NoopQuotaSettings),
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
            d.chats
                .create(&project_id_for_chat, &adapter_id_for_chat, None, None, None)
        })
        .unwrap();

    let chat_id_for_seed = chat.id.clone();
    db.call_blocking(move |d| {
        d.chats.update(
            &chat_id_for_seed,
            &ChatUpdate {
                claude_session_id: Some("sess-1".to_string()),
                transcript_missing: seed_missing,
                ..Default::default()
            },
        )
    })
    .unwrap();

    let manager = build_chat_manager(
        db.clone(),
        registry,
        Arc::new(BackgroundTaskTracker::new()),
        Arc::new(AttachmentStore::new(data_dir.path().join("attachments"))),
        Arc::new(PushService::new()),
        GitFactory,
        broadcast.clone(),
        Arc::new(NoopLaunchStopper),
        Arc::new(NoopScopeTunnelStopper),
        quota,
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    );

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
