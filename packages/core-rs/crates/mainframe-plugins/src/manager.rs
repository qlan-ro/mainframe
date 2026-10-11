//! Builtin plugin registry + the `/api/plugins` listing surface. Plugins are
//! builtin-only: there is no on-disk discovery path and no JS loader; only
//! `load_builtin` registers plugins. The per-plugin sub-router (returned by
//! `activate`) is mounted under `/<id>`, and `GET /` / `GET /:id` list the
//! loaded plugins with their tracked panels/actions.

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
    EmitSink, PluginContext, PluginContextDeps, PluginHostDb, build_plugin_context,
};
use crate::github_port::GitHubIssues;

/// Tracks panel/action registrations per plugin (the `panelEvents`/`actionEvents`
/// maps), kept outside the loaded-plugin entries so the tracking emit sink does
/// not form a reference cycle back through `PluginContext`.
#[derive(Default)]
struct Tracker {
    /// pluginId → the `plugin.panel.registered` events, in insertion order
    /// (keyed by panelId). A `Vec<(panelId, event)>` — not a `HashMap` — so the
    /// legacy `.panel` (= `panels[0]`) and the `.panels[]` array are deterministic.
    /// HashMap iteration order is randomized per launch, which would make the
    /// `/api/plugins` listing non-deterministic.
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
    pub emit: EmitSink,
    /// The GitHub Issues port, `None` when the automations engine
    /// did not start — `build_plugin_context` answers that case with the
    /// engine-unavailable guard rather than treating it as a fatal error.
    pub github: Option<Arc<dyn GitHubIssues>>,
}

pub struct PluginManager {
    inner: Arc<ManagerInner>,
    emit: EmitSink,
    host_db: Arc<dyn PluginHostDb>,
    github: Option<Arc<dyn GitHubIssues>>,
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
            github: deps.github,
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
            emit,
            github: self.github.clone(),
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

    #[cfg(test)]
    pub(crate) fn get_plugin(&self, id: &str) -> bool {
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
            // Legacy `panel` (= `panels[0]`) is absent when there are no
            // panels: omit the key entirely rather than emit `null`.
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

#[cfg(test)]
#[path = "manager_tests.rs"]
mod tests;
