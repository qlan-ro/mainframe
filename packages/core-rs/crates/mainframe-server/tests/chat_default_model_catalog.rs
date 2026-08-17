//! Wiring-level regression coverage for #290: the daemon's production
//! `ChatManagerDeps` (`DaemonChatDeps`, assembled by `build_chat_manager`) must
//! feed the lifecycle's default-model normalization the adapter registry's real
//! catalog, not an always-empty stub. A regression to the empty
//! `adapter_snapshot_models` default makes the first case here fail: a stale
//! saved provider default would leak, unchecked, into every new chat.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::sync::Arc;

use mainframe_adapter_api::{Adapter, AdapterRegistry};
use mainframe_adapter_api::{AdapterError, AdapterSession, BoxFuture};
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_db::DatabaseManager;
use mainframe_server::chat_seams::{NoopLaunchStopper, NoopScopeTunnelStopper};
use mainframe_server::{Db, GitFactory, build_chat_manager};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::push::PushService;
use mainframe_services::quota::{QuotaManager, QuotaManagerDeps, QuotaSettingsStore};
use mainframe_types::adapter::{AdapterCapabilities, AdapterModel};
use std::collections::HashMap;
use tempfile::TempDir;
use tokio::sync::broadcast;

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

/// A minimal `Adapter` double whose only purpose is to advertise a fixed model
/// catalog via `get_fallback_models()` so `AdapterRegistry::seed_static_snapshots`
/// can populate a snapshot without spawning a CLI. The test never starts a
/// session, so `create_session` is unreachable.
struct CatalogAdapter {
    id: String,
    models: Vec<AdapterModel>,
}

impl Adapter for CatalogAdapter {
    fn id(&self) -> &str {
        &self.id
    }
    fn name(&self) -> &str {
        &self.id
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
        }
    }
    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(true) })
    }
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        Box::pin(async { Ok(None) })
    }
    fn list_models(&self) -> BoxFuture<'_, Result<Vec<AdapterModel>, AdapterError>> {
        let models = self.models.clone();
        Box::pin(async move { Ok(models) })
    }
    fn get_fallback_models(&self) -> Option<Vec<AdapterModel>> {
        Some(self.models.clone())
    }
    fn create_session(
        &self,
        _options: mainframe_types::adapter::SessionOptions,
    ) -> Arc<dyn AdapterSession> {
        unreachable!("the catalog test never starts a session")
    }
    fn kill_all(&self) {}
}

fn model(id: &str) -> AdapterModel {
    AdapterModel {
        id: id.to_string(),
        label: id.to_string(),
        description: None,
        resolved_model: None,
        context_window: None,
        is_default: None,
        is_older: None,
        group: None,
        supported_efforts: None,
        default_effort: None,
        supports_fast: None,
        supports_ultracode: None,
        supports_adaptive_thinking: None,
        supports_personality: None,
    }
}

struct Harness {
    manager: Arc<mainframe_chat::chat_manager::ChatManager>,
    project_id: String,
    _data_dir: TempDir,
}

fn harness(saved_default: Option<&str>, chat_adapter_id: &str) -> Harness {
    let data_dir = tempfile::tempdir().unwrap();
    let db = Db::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap();
    let (broadcast, _keepalive) = broadcast::channel::<mainframe_types::events::DaemonEvent>(64);
    let tracker = Arc::new(mainframe_background_tasks::tracker::BackgroundTaskTracker::new());
    let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings: Box::new(NoopQuotaSettings),
        emit_event: Box::new(|_| {}),
        now: None,
    }));

    let registry = Arc::new(AdapterRegistry::new());
    registry.register(Arc::new(CatalogAdapter {
        id: "catalog-adapter".to_string(),
        models: vec![model("model-live"), model("model-also-live")],
    }));
    registry.seed_static_snapshots();

    let path = data_dir.path().to_string_lossy().into_owned();
    let project = db
        .call_blocking(move |d| d.projects.create(&path, None))
        .unwrap();

    if let Some(v) = saved_default {
        let key = format!("{chat_adapter_id}.defaultModel");
        let value = v.to_string();
        db.call_blocking(move |d| d.settings.set("provider", &key, &value))
            .unwrap();
    }

    let manager = build_chat_manager(
        db,
        registry,
        tracker,
        Arc::new(AttachmentStore::new(data_dir.path().join("attachments"))),
        Arc::new(PushService::new()),
        GitFactory,
        broadcast,
        Arc::new(NoopLaunchStopper),
        Arc::new(NoopScopeTunnelStopper),
        quota,
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    );

    Harness {
        manager,
        project_id: project.id,
        _data_dir: data_dir,
    }
}

/// The case that must fail before the production fix lands: the saved default
/// is not in the registered adapter's catalog, so it must be dropped and the
/// created chat must not carry it.
#[tokio::test]
async fn stale_saved_default_is_dropped_from_a_new_chat() {
    let h = harness(Some("model-retired"), "catalog-adapter");

    let chat = h
        .manager
        .create_chat_with_defaults(
            &h.project_id,
            "catalog-adapter",
            None,
            None,
            None,
            None,
            None,
        )
        .await;

    assert!(
        chat.model.is_none(),
        "a stale saved default must not survive onto a new chat, got {:?}",
        chat.model
    );
    assert_ne!(chat.model.as_deref(), Some("model-retired"));

    let reread = h.manager.get_chat(&chat.id).expect("chat must exist");
    assert!(
        reread.model.is_none(),
        "the stale default must not have been persisted either, got {:?}",
        reread.model
    );
}

/// A saved default that the adapter's catalog still offers must survive
/// unchanged onto the created chat.
#[tokio::test]
async fn saved_default_present_in_the_catalog_survives() {
    let h = harness(Some("model-live"), "catalog-adapter");

    let chat = h
        .manager
        .create_chat_with_defaults(
            &h.project_id,
            "catalog-adapter",
            None,
            None,
            None,
            None,
            None,
        )
        .await;

    assert_eq!(chat.model.as_deref(), Some("model-live"));
}

/// An adapter id with no registered snapshot must yield an empty catalog, which
/// is the "cannot judge" signal `normalize_saved_default_model` uses to preserve
/// the saved default (the probe-failure escape hatch stays intact).
#[tokio::test]
async fn an_adapter_without_a_snapshot_keeps_the_saved_default() {
    let h = harness(Some("model-retired"), "unregistered-adapter");

    let chat = h
        .manager
        .create_chat_with_defaults(
            &h.project_id,
            "unregistered-adapter",
            None,
            None,
            None,
            None,
            None,
        )
        .await;

    assert_eq!(chat.model.as_deref(), Some("model-retired"));
}
