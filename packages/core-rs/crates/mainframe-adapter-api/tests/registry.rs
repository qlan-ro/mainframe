//! Ported from `packages/core/src/adapters/__tests__/registry.test.ts`.
//!
//! Integration test (exercises only the public `AdapterRegistry` surface + the
//! `Adapter` / `AdapterSession` / `RefreshDeps` traits) so `lib.rs` stays a clean
//! port of `index.ts`. The five `AdapterRegistry catalog materialization`
//! assertions are ported one-for-one.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::adapter::{ContextFiles, StopBackgroundTaskResult};
use mainframe_adapter_api::{
    Adapter, AdapterError, AdapterRegistry, AdapterSession, BoxFuture, ControlResponse,
    RefreshDeps, RunResult, SessionSink,
};
use mainframe_types::adapter::{
    AdapterCapabilities, AdapterModel, AdapterProcess, CatalogSource, SessionOptions,
    SessionSpawnOptions,
};
use mainframe_types::chat::{ChatMessage, ResolvedTuning};
use mainframe_types::context::SkillFileEntry;
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;

fn model(id: &str, label: &str) -> AdapterModel {
    AdapterModel {
        id: id.into(),
        label: label.into(),
        description: None,
        context_window: None,
        is_default: None,
        supported_efforts: None,
        default_effort: None,
        supports_fast: None,
        supports_ultracode: None,
        supports_adaptive_thinking: None,
        supports_personality: None,
    }
}

// ─── a stub AdapterSession (never invoked in these tests, but required by the
//     Adapter::create_session signature) ────────────────────────────────────────
struct StubSession;
impl AdapterSession for StubSession {
    fn id(&self) -> &str {
        ""
    }
    fn adapter_id(&self) -> &str {
        ""
    }
    fn project_path(&self) -> &str {
        ""
    }
    fn is_spawned(&self) -> bool {
        false
    }
    fn spawn(
        &self,
        _options: Option<SessionSpawnOptions>,
        _sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin(async { Err(AdapterError::Message("stub".into())) })
    }
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn get_process_info(&self) -> Option<AdapterProcess> {
        None
    }
    fn send_message(
        &self,
        _message: String,
        _images: Vec<mainframe_adapter_api::ImageInput>,
        _uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn respond_to_permission(
        &self,
        _response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn set_model(&self, _model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn set_permission_mode(&self, _mode: ExecutionMode) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn set_plan_mode(&self, _on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn send_command(
        &self,
        _command: String,
        _args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn cancel_queued_message(&self, _uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(false) })
    }
    fn get_context_files(&self) -> ContextFiles {
        ContextFiles::default()
    }
    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn stop_background_task(
        &self,
        _task_id: String,
    ) -> BoxFuture<'_, Result<StopBackgroundTaskResult, AdapterError>> {
        Box::pin(async {
            Ok(StopBackgroundTaskResult {
                ok: false,
                error: Some("unsupported".into()),
            })
        })
    }
    fn apply_tuning(&self, _tuning: ResolvedTuning) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
}

// ─── the configurable fake Adapter (mirrors the TS `fakeAdapter`) ───────────────
struct FakeAdapter {
    id: String,
    name: String,
    has_probe: bool,
    probe_result: Option<Vec<AdapterModel>>,
    list_models_seq: Mutex<VecDeque<Vec<AdapterModel>>>,
    list_models_default: Vec<AdapterModel>,
    fallback_models: Vec<AdapterModel>,
    installed: bool,
    version: String,
    is_installed_calls: AtomicUsize,
    get_version_calls: AtomicUsize,
    list_models_calls: AtomicUsize,
    probe_calls: AtomicUsize,
    probe_args: Mutex<Vec<Option<String>>>,
}

impl FakeAdapter {
    fn new() -> Self {
        let fb = vec![model("fb", "Fallback")];
        Self {
            id: "claude".into(),
            name: "Claude".into(),
            has_probe: true,
            probe_result: None,
            list_models_seq: Mutex::new(VecDeque::new()),
            list_models_default: fb.clone(),
            fallback_models: fb,
            installed: true,
            version: "1.0.0".into(),
            is_installed_calls: AtomicUsize::new(0),
            get_version_calls: AtomicUsize::new(0),
            list_models_calls: AtomicUsize::new(0),
            probe_calls: AtomicUsize::new(0),
            probe_args: Mutex::new(Vec::new()),
        }
    }
    fn is_installed_count(&self) -> usize {
        self.is_installed_calls.load(Ordering::SeqCst)
    }
    fn get_version_count(&self) -> usize {
        self.get_version_calls.load(Ordering::SeqCst)
    }
    fn list_models_count(&self) -> usize {
        self.list_models_calls.load(Ordering::SeqCst)
    }
    fn probe_count(&self) -> usize {
        self.probe_calls.load(Ordering::SeqCst)
    }
    fn probe_args(&self) -> Vec<Option<String>> {
        self.probe_args.lock().unwrap().clone()
    }
}

impl Adapter for FakeAdapter {
    fn id(&self) -> &str {
        &self.id
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities { plan_mode: true }
    }
    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        self.is_installed_calls.fetch_add(1, Ordering::SeqCst);
        let v = self.installed;
        Box::pin(async move { Ok(v) })
    }
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        self.get_version_calls.fetch_add(1, Ordering::SeqCst);
        let v = self.version.clone();
        Box::pin(async move { Ok(Some(v)) })
    }
    fn list_models(&self) -> BoxFuture<'_, Result<Vec<AdapterModel>, AdapterError>> {
        self.list_models_calls.fetch_add(1, Ordering::SeqCst);
        let models = self
            .list_models_seq
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| self.list_models_default.clone());
        Box::pin(async move { Ok(models) })
    }
    fn has_probe_models(&self) -> bool {
        self.has_probe
    }
    fn probe_models(
        &self,
        executable_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<Vec<AdapterModel>>, AdapterError>> {
        self.probe_calls.fetch_add(1, Ordering::SeqCst);
        self.probe_args.lock().unwrap().push(executable_path);
        let r = self.probe_result.clone();
        Box::pin(async move { Ok(r) })
    }
    fn get_fallback_models(&self) -> Option<Vec<AdapterModel>> {
        Some(self.fallback_models.clone())
    }
    fn create_session(&self, _options: SessionOptions) -> Arc<dyn AdapterSession> {
        Arc::new(StubSession)
    }
    fn kill_all(&self) {}
}

// ─── the injected RefreshDeps fake (mirrors the TS `deps(emit, path)`) ──────────
struct FakeDeps {
    resolve_path: Option<String>,
    run_result: RunResult,
    events: Arc<Mutex<Vec<DaemonEvent>>>,
}
impl RefreshDeps for FakeDeps {
    fn resolve_executable_path(&self, _adapter_id: String) -> BoxFuture<'_, Option<String>> {
        let p = self.resolve_path.clone();
        Box::pin(async move { p })
    }
    fn run(
        &self,
        _cmd: String,
        _args: Vec<String>,
        _timeout_ms: Option<u64>,
    ) -> BoxFuture<'_, RunResult> {
        let r = self.run_result.clone();
        Box::pin(async move { r })
    }
    fn emit_event(&self, event: DaemonEvent) {
        self.events.lock().unwrap().push(event);
    }
}

fn ok_run(stdout: &str) -> RunResult {
    RunResult {
        ok: true,
        stdout: stdout.into(),
    }
}

#[tokio::test]
async fn seeds_statically_without_spawning() {
    let a = Arc::new(FakeAdapter::new());
    let reg = AdapterRegistry::new();
    reg.register(a.clone());
    reg.seed_static_snapshots();
    let snaps = reg.get_snapshots();
    assert_eq!(snaps[0].catalog_source, Some(CatalogSource::Fallback));
    assert_eq!(snaps[0].models_revision, Some(1));
    assert_eq!(a.is_installed_count(), 0);
    assert_eq!(a.get_version_count(), 0);
    assert_eq!(a.list_models_count(), 0);
}

#[tokio::test]
async fn refuses_to_refresh_until_allow_refresh() {
    let mut fa = FakeAdapter::new();
    fa.probe_result = Some(vec![model("live", "Live")]);
    let a = Arc::new(fa);
    let events = Arc::new(Mutex::new(Vec::new()));
    let reg = AdapterRegistry::new();
    reg.register(a.clone());
    reg.seed_static_snapshots();
    reg.configure_refresh(Arc::new(FakeDeps {
        resolve_path: Some("/abs/claude".into()),
        run_result: ok_run("claude 2.0.0"),
        events: events.clone(),
    }));
    reg.list().await; // refresh not allowed yet
    assert_eq!(a.probe_count(), 0);
    assert!(events.lock().unwrap().is_empty());
    assert_eq!(
        reg.get_snapshots()[0].catalog_source,
        Some(CatalogSource::Fallback)
    );
}

#[tokio::test]
async fn bumps_revision_flips_catalog_source_and_emits_after_allow_refresh() {
    let probed = vec![model("live", "Live")];
    let mut fa = FakeAdapter::new();
    fa.probe_result = Some(probed.clone());
    let a = Arc::new(fa);
    let events = Arc::new(Mutex::new(Vec::new()));
    let reg = AdapterRegistry::new();
    reg.register(a.clone());
    reg.seed_static_snapshots();
    reg.configure_refresh(Arc::new(FakeDeps {
        resolve_path: Some("/abs/claude".into()),
        run_result: ok_run("claude 2.0.0"),
        events: events.clone(),
    }));
    reg.allow_refresh();
    reg.refresh_all().await;
    let info = reg.get_snapshots()[0].clone();
    assert_eq!(info.catalog_source, Some(CatalogSource::Probed));
    assert_eq!(info.models_revision, Some(2));
    assert_eq!(info.models, probed);
    assert!(
        events
            .lock()
            .unwrap()
            .contains(&DaemonEvent::AdapterModelsUpdated {
                adapter_id: "claude".into(),
                models: probed.clone(),
                models_revision: 2,
            })
    );
    assert_eq!(a.probe_args(), vec![Some("/abs/claude".to_string())]);
}

#[tokio::test]
async fn latches_per_adapter_failed_retries_succeeded_does_not() {
    let mut ok_fa = FakeAdapter::new();
    ok_fa.probe_result = Some(vec![model("ok", "OK")]);
    let ok = Arc::new(ok_fa);

    let mut bad_fa = FakeAdapter::new();
    bad_fa.id = "codex".into();
    bad_fa.name = "Codex".into();
    bad_fa.has_probe = false;
    bad_fa.list_models_seq = Mutex::new(VecDeque::from([vec![], vec![model("c", "C")]]));
    bad_fa.list_models_default = vec![];
    bad_fa.fallback_models = vec![];
    let bad = Arc::new(bad_fa);

    let events = Arc::new(Mutex::new(Vec::new()));
    let reg = AdapterRegistry::new();
    reg.register(ok.clone());
    reg.register(bad.clone());
    reg.seed_static_snapshots();
    reg.configure_refresh(Arc::new(FakeDeps {
        resolve_path: Some("/abs/claude".into()),
        run_result: ok_run("claude 2.0.0"),
        events,
    }));
    reg.allow_refresh();
    reg.refresh_all().await; // ok succeeds+latches; codex returns [] → not latched
    reg.refresh_all().await; // ok skipped (latched); codex retries → succeeds
    assert_eq!(ok.probe_count(), 1);
    assert_eq!(bad.list_models_count(), 2);
}

#[tokio::test]
async fn skips_live_discovery_for_an_uninstalled_adapter() {
    let mut fa = FakeAdapter::new();
    fa.probe_result = Some(vec![model("live", "Live")]);
    fa.installed = false;
    let a = Arc::new(fa);
    let reg = AdapterRegistry::new();
    reg.register(a.clone());
    reg.seed_static_snapshots();
    // --version fails → installed === false → no probe.
    reg.configure_refresh(Arc::new(FakeDeps {
        resolve_path: None,
        run_result: RunResult {
            ok: false,
            stdout: String::new(),
        },
        events: Arc::new(Mutex::new(Vec::new())),
    }));
    reg.allow_refresh();
    reg.refresh_all().await;
    assert_eq!(a.probe_count(), 0);
    assert!(!reg.get_snapshots()[0].installed);
    assert_eq!(
        reg.get_snapshots()[0].catalog_source,
        Some(CatalogSource::Fallback)
    );
}
