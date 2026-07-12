//! Ported from `packages/core/src/plugins/manager.ts`.
//!
//! Builtin plugin registry + the `/api/plugins` listing surface. v1 is
//! builtin-only (§2.9/§5): the on-disk `loadAll`/`loadPlugin` discovery path and
//! the `_require` JS loader are dropped; only `load_builtin` remains. The
//! per-plugin sub-router (returned by `activate`) is mounted under `/<id>`, and
//! `GET /` / `GET /:id` list the loaded plugins with their tracked panels/actions.

use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use axum::routing::get;
use dashmap::DashMap;
use mainframe_types::events::DaemonEvent;
use mainframe_types::plugin::PluginManifest;
use serde_json::{Value, json};

use crate::PluginError;
use crate::context::{
    AdapterRegistrar, EmitSink, PluginContext, PluginContextDeps, PluginHostDb,
    build_plugin_context,
};
use crate::event_bus::PublicDaemonBus;

/// Tracks panel/action registrations per plugin (the `panelEvents`/`actionEvents`
/// maps), kept outside the loaded-plugin entries so the tracking emit sink does
/// not form a reference cycle back through `PluginContext`.
#[derive(Default)]
struct Tracker {
    /// pluginId → the `plugin.panel.registered` events, in insertion order
    /// (keyed by panelId). A `Vec<(panelId, event)>` — not a `HashMap` — so the
    /// legacy `.panel` (= `panels[0]`) and the `.panels[]` array are deterministic,
    /// matching the TS insertion-ordered `Map<panelId, event>`. HashMap iteration
    /// order is randomized per launch, which made the `/api/plugins` listing
    /// (and hence the diffd `plugins-list` probe) non-deterministic.
    panels: DashMap<String, Vec<(String, DaemonEvent)>>,
    /// pluginId → the `plugin.action.registered` events.
    actions: DashMap<String, Vec<DaemonEvent>>,
}

impl Tracker {
    fn record(&self, plugin_id: &str, event: &DaemonEvent) {
        match event {
            DaemonEvent::PluginPanelRegistered { panel_id, .. } => {
                let mut list = self.panels.entry(plugin_id.to_string()).or_default();
                // `Map.set(panelId, event)`: replace in place if the panel is
                // re-registered (preserving its slot), else append.
                match list.iter_mut().find(|(pid, _)| pid == panel_id) {
                    Some(slot) => slot.1 = event.clone(),
                    None => list.push((panel_id.clone(), event.clone())),
                }
            }
            DaemonEvent::PluginPanelUnregistered { panel_id, .. } => match panel_id {
                Some(pid) => {
                    if let Some(mut list) = self.panels.get_mut(plugin_id) {
                        list.retain(|(p, _)| p != pid);
                        if list.is_empty() {
                            drop(list);
                            self.panels.remove(plugin_id);
                        }
                    }
                }
                None => {
                    self.panels.remove(plugin_id);
                }
            },
            DaemonEvent::PluginActionRegistered { .. } => {
                self.actions
                    .entry(plugin_id.to_string())
                    .or_default()
                    .push(event.clone());
            }
            DaemonEvent::PluginActionUnregistered { action_id, .. } => {
                if let Some(mut list) = self.actions.get_mut(plugin_id) {
                    list.retain(|e| !matches!(e, DaemonEvent::PluginActionRegistered { action_id: a, .. } if a == action_id));
                    if list.is_empty() {
                        drop(list);
                        self.actions.remove(plugin_id);
                    }
                }
            }
            _ => {}
        }
    }

    fn panel_summaries(&self, plugin_id: &str) -> Vec<Value> {
        self.panels
            .get(plugin_id)
            .map(|list| list.iter().filter_map(|(_, e)| panel_summary(e)).collect())
            .unwrap_or_default()
    }

    fn action_summaries(&self, plugin_id: &str) -> Vec<Value> {
        self.actions
            .get(plugin_id)
            .map(|list| list.iter().filter_map(action_summary).collect())
            .unwrap_or_default()
    }
}

fn panel_summary(event: &DaemonEvent) -> Option<Value> {
    if let DaemonEvent::PluginPanelRegistered {
        panel_id,
        zone,
        label,
        icon,
        ..
    } = event
    {
        Some(json!({ "panelId": panel_id, "zone": zone, "label": label, "icon": icon }))
    } else {
        None
    }
}

fn action_summary(event: &DaemonEvent) -> Option<Value> {
    if let DaemonEvent::PluginActionRegistered {
        plugin_id,
        action_id,
        label,
        shortcut,
        icon,
    } = event
    {
        Some(json!({
            "id": action_id, "pluginId": plugin_id,
            "label": label, "shortcut": shortcut, "icon": icon,
        }))
    } else {
        None
    }
}

struct LoadedPlugin {
    manifest: PluginManifest,
    ctx: Arc<PluginContext>,
    router: Router<()>,
}

struct ManagerInner {
    loaded: DashMap<String, LoadedPlugin>,
    tracker: Arc<Tracker>,
}

/// Constructor dependencies (`PluginManagerDeps`, minus the dropped
/// `pluginsDirs`).
pub struct PluginManagerDeps {
    pub host_db: Arc<dyn PluginHostDb>,
    pub daemon_bus: Arc<PublicDaemonBus>,
    pub emit: EmitSink,
    pub adapters: Option<Arc<dyn AdapterRegistrar>>,
}

pub struct PluginManager {
    inner: Arc<ManagerInner>,
    emit: EmitSink,
    host_db: Arc<dyn PluginHostDb>,
    daemon_bus: Arc<PublicDaemonBus>,
    adapters: Option<Arc<dyn AdapterRegistrar>>,
}

impl PluginManager {
    pub fn new(deps: PluginManagerDeps) -> Self {
        Self {
            inner: Arc::new(ManagerInner {
                loaded: DashMap::new(),
                tracker: Arc::new(Tracker::default()),
            }),
            emit: deps.emit,
            host_db: deps.host_db,
            daemon_bus: deps.daemon_bus,
            adapters: deps.adapters,
        }
    }

    /// `loadBuiltin(manifest, activate)` — build the context (with a tracking emit
    /// sink), run `activate` to obtain the sub-router, and register the plugin.
    /// Duplicate ids are a no-op, matching the early `return`.
    pub async fn load_builtin<F, Fut>(
        &self,
        manifest: PluginManifest,
        plugin_dir: PathBuf,
        activate: F,
    ) -> Result<(), PluginError>
    where
        F: FnOnce(Arc<PluginContext>) -> Fut,
        Fut: Future<Output = Result<Router<()>, PluginError>>,
    {
        if self.inner.loaded.contains_key(&manifest.id) {
            return Ok(());
        }
        let emit = tracking_emit(
            Arc::clone(&self.inner.tracker),
            manifest.id.clone(),
            Arc::clone(&self.emit),
        );
        let ctx = build_plugin_context(PluginContextDeps {
            manifest: manifest.clone(),
            plugin_dir,
            host_db: Arc::clone(&self.host_db),
            daemon_bus: Arc::clone(&self.daemon_bus),
            emit,
            adapters: self.adapters.clone(),
        })?;
        let router = activate(Arc::clone(&ctx)).await?;
        let id = manifest.id.clone();
        self.inner.loaded.insert(
            id.clone(),
            LoadedPlugin {
                manifest,
                ctx,
                router,
            },
        );
        tracing::info!(id, "Builtin plugin loaded");
        Ok(())
    }

    /// `unloadAll()` — run every plugin's onUnload callbacks and clear state.
    pub fn unload_all(&self) {
        for entry in self.inner.loaded.iter() {
            for cb in entry.value().ctx.take_unload_callbacks() {
                cb();
            }
        }
        self.inner.loaded.clear();
        self.inner.tracker.panels.clear();
        self.inner.tracker.actions.clear();
    }

    pub fn get_plugin(&self, id: &str) -> bool {
        self.inner.loaded.contains_key(id)
    }

    pub fn get_all(&self) -> Vec<String> {
        self.inner.loaded.iter().map(|e| e.key().clone()).collect()
    }

    /// The `/api/plugins` router: `GET /`, `GET /:id`, and every plugin's
    /// sub-router nested under `/<id>`.
    pub fn router(&self) -> Router {
        let mut app: Router = Router::new()
            .route("/", get(list_plugins))
            .route("/{id}", get(plugin_detail))
            .with_state(Arc::clone(&self.inner));
        for entry in self.inner.loaded.iter() {
            app = app.nest(&format!("/{}", entry.key()), entry.value().router.clone());
        }
        app
    }
}

/// Wrap the real emit sink so panel/action events are recorded before fan-out
/// (the `trackingEmitEvent` closure).
fn tracking_emit(tracker: Arc<Tracker>, plugin_id: String, real: EmitSink) -> EmitSink {
    Arc::new(move |event: DaemonEvent| {
        tracker.record(&plugin_id, &event);
        real(event);
    })
}

async fn list_plugins(State(inner): State<Arc<ManagerInner>>) -> Response {
    let plugins: Vec<Value> = inner
        .loaded
        .iter()
        .map(|entry| {
            let p = entry.value();
            let panels = inner.tracker.panel_summaries(&p.manifest.id);
            let actions = inner.tracker.action_summaries(&p.manifest.id);
            let mut obj = serde_json::Map::new();
            obj.insert("id".into(), json!(p.manifest.id));
            obj.insert("name".into(), json!(p.manifest.name));
            obj.insert("version".into(), json!(p.manifest.version));
            obj.insert(
                "capabilities".into(),
                serde_json::to_value(&p.manifest.capabilities).unwrap_or(Value::Null),
            );
            // Legacy `panel` (TS: `panels[0]`) is `undefined` when there are no
            // panels — JSON.stringify drops it, so omit the key entirely rather
            // than emit `null`, matching the Express listing byte-for-byte.
            if let Some(first) = panels.first() {
                obj.insert("panel".into(), json!(first));
            }
            obj.insert("panels".into(), json!(panels));
            obj.insert("actions".into(), json!(actions));
            Value::Object(obj)
        })
        .collect();
    (StatusCode::OK, Json(json!({ "plugins": plugins }))).into_response()
}

async fn plugin_detail(State(inner): State<Arc<ManagerInner>>, Path(id): Path<String>) -> Response {
    match inner.loaded.get(&id) {
        Some(entry) => {
            let p = entry.value();
            (
                StatusCode::OK,
                Json(json!({
                    "id": p.manifest.id,
                    "name": p.manifest.name,
                    "version": p.manifest.version,
                    "description": p.manifest.description,
                    "capabilities": serde_json::to_value(&p.manifest.capabilities).unwrap_or(Value::Null),
                })),
            )
                .into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Plugin not found" })),
        )
            .into_response(),
    }
}

// PORT STATUS: src/plugins/manager.ts
// confidence: medium
// todos: 1
// notes: builtin-only (§2.9/§5) — loadAll/loadPlugin disk discovery + the
// `_require` JS loader are dropped; only load_builtin remains. panelEvents →
// DashMap<pluginId, Vec<(panelId, event)>> (insertion-ordered, mirroring the TS
// Map<panelId, event>), actionEvents → DashMap<pluginId, Vec<event>>, updated by a
// tracking emit sink (kept off the LoadedPlugin entries to avoid a ctx↔sink Arc
// cycle). The insertion-ordered Vec (not a HashMap) makes the legacy `.panel`
// (= panels[0]) and `.panels[]` deterministic per launch. The listing routes
// (GET / and GET /:id) + per-plugin `/<id>` nesting mirror the Express router
// surface. TODO(port): external/on-disk plugin loading dropped in v1.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::NotifyOptions;
    use mainframe_types::chat::{Chat, Project};
    use mainframe_types::plugin::UiZone;
    use std::sync::Mutex;

    #[derive(Default)]
    struct NullHostDb;
    impl PluginHostDb for NullHostDb {
        fn chats_list(&self, _p: &str) -> Vec<Chat> {
            Vec::new()
        }
        fn chats_get(&self, _id: &str) -> Option<Chat> {
            None
        }
        fn chats_create(&self, p: &str, a: &str, _m: Option<&str>, _mode: Option<&str>) -> Chat {
            serde_json::from_value(json!({
                "id": "chat-1", "adapterId": a, "projectId": p, "status": "active",
                "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z",
                "totalCost": 0.0, "totalTokensInput": 0, "totalTokensOutput": 0,
                "lastContextTokensInput": 0,
            }))
            .unwrap()
        }
        fn settings_get(&self, _c: &str, _k: &str) -> Option<String> {
            None
        }
        fn settings_set(&self, _c: &str, _k: &str, _v: &str) {}
        fn projects_list(&self) -> Vec<Project> {
            Vec::new()
        }
        fn projects_get(&self, _id: &str) -> Option<Project> {
            None
        }
    }

    fn manager() -> (PluginManager, Arc<Mutex<Vec<DaemonEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let emit: EmitSink = Arc::new(move |e| sink.lock().unwrap().push(e));
        let mgr = PluginManager::new(PluginManagerDeps {
            host_db: Arc::new(NullHostDb),
            daemon_bus: Arc::new(PublicDaemonBus::new()),
            emit,
            adapters: None,
        });
        (mgr, events)
    }

    fn manifest(id: &str, caps: Vec<mainframe_types::plugin::PluginCapability>) -> PluginManifest {
        PluginManifest {
            id: id.into(),
            name: id.into(),
            version: "1.0.0".into(),
            description: None,
            author: None,
            license: None,
            capabilities: caps,
            ui: None,
            adapter: None,
            commands: None,
        }
    }

    async fn read(resp: Response) -> (StatusCode, Value) {
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    #[tokio::test]
    async fn load_builtin_registers_and_activates() {
        let (mgr, _e) = manager();
        let activated = Arc::new(Mutex::new(false));
        let flag = Arc::clone(&activated);
        mgr.load_builtin(
            manifest("test-builtin", vec![]),
            PathBuf::new(),
            move |_ctx| {
                let flag = Arc::clone(&flag);
                async move {
                    *flag.lock().unwrap() = true;
                    Ok(Router::new())
                }
            },
        )
        .await
        .unwrap();
        assert!(*activated.lock().unwrap());
        assert!(mgr.get_plugin("test-builtin"));
    }

    #[tokio::test]
    async fn duplicate_id_is_skipped() {
        let (mgr, _e) = manager();
        mgr.load_builtin(manifest("dup", vec![]), PathBuf::new(), |_c| async {
            Ok(Router::new())
        })
        .await
        .unwrap();
        let second = Arc::new(Mutex::new(false));
        let flag = Arc::clone(&second);
        mgr.load_builtin(manifest("dup", vec![]), PathBuf::new(), move |_c| {
            let flag = Arc::clone(&flag);
            async move {
                *flag.lock().unwrap() = true;
                Ok(Router::new())
            }
        })
        .await
        .unwrap();
        assert!(
            !*second.lock().unwrap(),
            "activate must not run for a duplicate id"
        );
        assert_eq!(mgr.get_all().len(), 1);
    }

    #[tokio::test]
    async fn unload_all_runs_callbacks_and_clears() {
        let (mgr, _e) = manager();
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let l = Arc::clone(&log);
        mgr.load_builtin(manifest("cleanup", vec![]), PathBuf::new(), move |ctx| {
            let l = Arc::clone(&l);
            async move {
                let a = Arc::clone(&l);
                ctx.on_unload(move || a.lock().unwrap().push("step1".into()));
                let b = Arc::clone(&l);
                ctx.on_unload(move || b.lock().unwrap().push("step2".into()));
                Ok(Router::new())
            }
        })
        .await
        .unwrap();
        assert!(mgr.get_plugin("cleanup"));
        mgr.unload_all();
        assert_eq!(mgr.get_all().len(), 0);
        assert_eq!(log.lock().unwrap().as_slice(), ["step1", "step2"]);
    }

    #[tokio::test]
    async fn add_panel_records_and_emits_event() {
        let (mgr, events) = manager();
        mgr.load_builtin(
            manifest(
                "ui-plugin",
                vec![mainframe_types::plugin::PluginCapability::UiPanels],
            ),
            PathBuf::new(),
            |ctx| async move {
                ctx.ui.add_panel(UiZone::Fullview, "My Panel", None);
                Ok(Router::new())
            },
        )
        .await
        .unwrap();

        assert!(events.lock().unwrap().iter().any(|e| matches!(
            e,
            DaemonEvent::PluginPanelRegistered { plugin_id, label, .. }
                if plugin_id == "ui-plugin" && label == "My Panel"
        )));

        // Listing reflects the tracked panel.
        let (status, body) = read(list_plugins(State(Arc::clone(&mgr.inner))).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["plugins"][0]["panels"][0]["label"], json!("My Panel"));
    }

    #[tokio::test]
    async fn panels_preserve_insertion_order() {
        // Two panels registered fullview-then-sidebar must list in that order
        // (and `.panel` = panels[0] must be the fullview one) on every run — the
        // Vec-backed tracker is deterministic where the old HashMap was not.
        let (mgr, _e) = manager();
        mgr.load_builtin(
            manifest(
                "ordered",
                vec![mainframe_types::plugin::PluginCapability::UiPanels],
            ),
            PathBuf::new(),
            |ctx| async move {
                ctx.ui.add_panel(UiZone::Fullview, "First", None);
                ctx.ui.add_panel(UiZone::RightTop, "Second", None);
                Ok(Router::new())
            },
        )
        .await
        .unwrap();
        let (_, body) = read(list_plugins(State(Arc::clone(&mgr.inner))).await).await;
        assert_eq!(body["plugins"][0]["panels"][0]["label"], json!("First"));
        assert_eq!(body["plugins"][0]["panels"][1]["label"], json!("Second"));
        assert_eq!(body["plugins"][0]["panel"]["label"], json!("First"));
    }

    #[tokio::test]
    async fn notify_without_panel_does_not_track() {
        let (mgr, events) = manager();
        mgr.load_builtin(
            manifest(
                "noisy",
                vec![mainframe_types::plugin::PluginCapability::UiNotifications],
            ),
            PathBuf::new(),
            |ctx| async move {
                ctx.ui.notify(NotifyOptions {
                    title: "t".into(),
                    body: "b".into(),
                    level: None,
                });
                Ok(Router::new())
            },
        )
        .await
        .unwrap();
        assert!(
            events
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, DaemonEvent::PluginNotification { .. }))
        );
        let (_, body) = read(list_plugins(State(Arc::clone(&mgr.inner))).await).await;
        assert_eq!(body["plugins"][0]["panels"], json!([]));
    }

    #[tokio::test]
    async fn detail_404_for_unknown() {
        let (mgr, _e) = manager();
        let (status, body) =
            read(plugin_detail(State(Arc::clone(&mgr.inner)), Path("nope".into())).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body, json!({ "error": "Plugin not found" }));
    }

    #[tokio::test]
    async fn router_mounts_listing_and_sub_routes() {
        let (mgr, _e) = manager();
        mgr.load_builtin(manifest("list-test", vec![]), PathBuf::new(), |_c| async {
            Ok(Router::new())
        })
        .await
        .unwrap();
        mgr.load_builtin(
            manifest("route-plugin", vec![]),
            PathBuf::new(),
            |_c| async {
                Ok(Router::new().route("/status", get(|| async { Json(json!({ "ok": true })) })))
            },
        )
        .await
        .unwrap();

        let app = mgr.router();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let base = format!("http://{addr}");

        let list: Value = reqwest::get(format!("{base}/"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(list["plugins"].as_array().unwrap().len(), 2);

        let sub: Value = reqwest::get(format!("{base}/route-plugin/status"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(sub["ok"], json!(true));

        let missing = reqwest::get(format!("{base}/does-not-exist"))
            .await
            .unwrap();
        assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);
    }
}
