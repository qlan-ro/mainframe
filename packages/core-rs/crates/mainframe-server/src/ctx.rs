//! `AppCtx` — the Arc-shared application context every route module and the WS
//! layer read. Mirrors the `ctx` object assembled in `src/server/http.ts` plus
//! the `HttpServerDeps` / WebSocketManager collaborators, narrowed to the
//! Phase-3 surface (chat/adapter/launch/plugin/workflow managers are Phase 4/5).

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use mainframe_adapter_api::AdapterRegistry;
use mainframe_automations::AutomationsEngine;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_chat::chat_manager::ChatManager;
use mainframe_launch::{LaunchRegistry, TunnelManager};
use mainframe_lsp::LspManager;
use mainframe_plugins::PluginManager;
use mainframe_runtime::ResolvedPath;
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_services::quota::QuotaService;
use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use crate::db::Db;
use crate::websocket::WsClients;

/// The `defaultRun` process runner, as the `Runner` trait resolve-executable
/// injects. `resolveAdapterExecutable` (the settings `resolvedExecutable`
/// enrichment and the daemon's refresh deps) takes `&dyn Runner`; this is the
/// single production impl over `default_run` (`execFile` + 5s timeout).
///
/// Carries the boot-resolved login-shell `PATH` so `which`/`where` detection and
/// version probes find CLIs outside the packaged app's bare `PATH` (the TS twin
/// relied on `enrichPath` mutating `process.env.PATH`).
#[derive(Default)]
pub struct DefaultRunner {
    pub path: Option<ResolvedPath>,
}

impl DefaultRunner {
    #[must_use]
    pub fn new(path: ResolvedPath) -> Self {
        Self { path: Some(path) }
    }
}

impl mainframe_adapter_api::resolve_executable::Runner for DefaultRunner {
    fn run(
        &self,
        cmd: String,
        args: Vec<String>,
        timeout_ms: Option<u64>,
    ) -> mainframe_adapter_api::BoxFuture<'_, mainframe_adapter_api::RunResult> {
        let path = self.path.clone();
        Box::pin(async move {
            mainframe_adapter_api::resolve_executable::default_run(
                &cmd,
                &args,
                timeout_ms,
                path.as_deref(),
            )
            .await
        })
    }
}

/// Stateless per-project `GitService` factory (the contract's `git` handle).
/// `GitService::for_project` carries no shared state, and per-project write
/// serialization uses the module-level lock in `mainframe_git`, so this is a
/// zero-sized entry point — route modules call `ctx.git.for_project(path)`.
#[derive(Clone, Copy, Default)]
pub struct GitFactory;

impl GitFactory {
    /// Build a `GitService` scoped to `project_path`. Mirrors the TS
    /// `new GitService(projectPath)` call route handlers make per request.
    pub fn for_project(&self, project_path: impl Into<String>) -> mainframe_git::GitService {
        mainframe_git::GitService::for_project(project_path)
    }
}

/// The cross-cutting daemon service handles (§2.4). `commands` and
/// `provider-config` are free functions over the db, not stored handles, so they
/// have no field here — route modules call them with `ctx.db`.
#[derive(Clone)]
pub struct Services {
    pub attachments: Arc<AttachmentStore>,
    pub push: Arc<PushService>,
    pub watcher: Arc<FileWatcherService>,
}

/// Shared application context. Built once in the daemon and handed to axum as
/// `Arc<AppCtx>` state; `Db`, the service handles, and the broadcast sender are
/// all `Send + Sync + Clone`, so the whole struct is `Send + Sync`.
pub struct AppCtx {
    pub db: Db,
    /// Per-project git command factory (contract `git` handle).
    pub git: GitFactory,
    pub services: Services,
    /// Event fan-out. Route handlers and the file watcher publish here; the WS
    /// layer subscribes and applies per-chat gating (§ws-events broadcastScoping).
    pub broadcast: broadcast::Sender<DaemonEvent>,
    /// The live WS client registry (tsv SHARED_MAP `clients`), consulted by the
    /// broadcast fan-out and populated per connection.
    pub ws_clients: WsClients,
    /// The `AdapterRegistry` (contract `adapters` handle). Backs `GET /api/adapters`
    /// (`list()` with installed/version probing) and the agents/skills routes'
    /// existence check. Cheap to construct (`AdapterRegistry::new()`), so it is a
    /// concrete handle rather than a Phase-4 `Option` seam.
    pub adapter_registry: Arc<AdapterRegistry>,
    /// The `BackgroundTaskTracker` (contract `backgroundTasks` handle). Backs the
    /// `/api/chats/:chatId/background-tasks*` routes. Cheap to construct, so concrete.
    pub background_tasks: Arc<BackgroundTaskTracker>,
    /// The `ChatManager` (contract `chats` handle). `None` until the daemon boot
    /// (the next task) wires construction — `ChatManager::new` needs a full
    /// `ChatManagerDeps` impl, so the Phase-3 test harness cannot build one. Chat
    /// route handlers gate on `Some` and fall back to the TS failure-path envelope
    /// when absent (mirrors the `projects::remove` Phase-4 seam).
    pub chat_manager: Option<Arc<ChatManager>>,
    /// The per-project `LaunchRegistry` (contract `launchRegistry` handle). Backs
    /// the `/api/projects/:id/launch/*` routes. `None` in the route-unit harness.
    pub launch_registry: Option<Arc<LaunchRegistry>>,
    /// The cloudflared `TunnelManager` (contract `tunnelManager` handle). Backs the
    /// `/api/tunnel/*` routes. `None` in the route-unit harness.
    pub tunnel_manager: Option<Arc<TunnelManager>>,
    /// The `LspManager` (contract `lspManager` handle). Backs `GET
    /// /api/lsp/languages` and the `/lsp/:projectId/:language` WS upgrade. `None`
    /// in the route-unit harness.
    pub lsp_manager: Option<Arc<LspManager>>,
    /// The `PluginManager` (contract `pluginManager` handle). Its router is nested
    /// under `/api/plugins` by `build_app`. `None` in the route-unit harness.
    pub plugin_manager: Option<Arc<PluginManager>>,
    /// The Automations v2 engine (T9.2). `Some` in the daemon boot; `None` in
    /// the route-unit harness — automation routes answer 503 while absent
    /// (Node parity: "automation service not available").
    pub automations: Option<Arc<AutomationsEngine>>,
    /// The account-wide provider quota service (`quota` handle). Backs the
    /// `/api/providers/:id/quota*` routes; `None` in the route-unit harness and
    /// when quota harvesting is not wired — routes answer `okEmpty` / `503`.
    pub quota: Option<Arc<dyn QuotaService>>,
    pub data_dir: PathBuf,
    pub version: String,
    /// The daemon listen port (`config.port`). The tunnel `start` route needs it to
    /// spawn cloudflared against `http://localhost:{port}`.
    pub port: u16,
    /// `AUTH_TOKEN_SECRET`. `None` disables auth entirely (middleware + WS
    /// upgrade become no-ops) — the exact `whenSecretUnset` contract.
    pub auth_secret: Option<String>,
    /// The boot-resolved login-shell `PATH` (see `mainframe_runtime::ResolvedPath`).
    /// Threaded into on-demand executable resolution (settings route) and any
    /// route that spawns a CLI, mirroring the TS `enrichPath` env mutation.
    pub resolved_path: ResolvedPath,
    /// `/health`'s `tunnelUrl`. Interior-mutable so the tunnel routes' `setTunnelUrl`
    /// and the boot-time daemon-tunnel start can update what `/health` reports —
    /// mirrors the mutated `ctx.tunnelUrl` closure in `http.ts`.
    pub tunnel_url: Arc<RwLock<Option<String>>>,
}

impl AppCtx {
    /// Read the current `/health` tunnel URL (`ctx.tunnelUrl ?? getTunnelUrl?.()`).
    pub fn tunnel_url(&self) -> Option<String> {
        self.tunnel_url
            .read()
            .map(|guard| guard.clone())
            .unwrap_or(None)
    }

    /// `setTunnelUrl(url)` — the mutator the tunnel routes call after start/stop.
    pub fn set_tunnel_url(&self, url: Option<String>) {
        if let Ok(mut guard) = self.tunnel_url.write() {
            *guard = url;
        }
    }

    /// Worktree-aware effective path (`getEffectivePath(ctx, projectId, chatId)`
    /// from `routes/types.ts`): the chat's worktree when the chatId points to a
    /// live worktree of this project; the project root otherwise. `None` on an
    /// unknown project, a cross-project chat, or a missing worktree.
    pub async fn effective_path(&self, project_id: &str, chat_id: Option<&str>) -> Option<String> {
        let pid = project_id.to_string();
        let cid = chat_id.map(str::to_string);
        self.db
            .call(move |d| {
                let Some(project) = d.projects.get(&pid)? else {
                    return Ok(None);
                };
                if let Some(cid) = &cid
                    && let Some(chat) = d.chats.get(cid)?
                {
                    // Reject cross-project access.
                    if chat.project_id != pid {
                        return Ok(None);
                    }
                    if let Some(worktree_path) = &chat.worktree_path
                        && !worktree_path.is_empty()
                    {
                        if chat.worktree_missing == Some(true) {
                            return Ok(None);
                        }
                        return Ok(Some(worktree_path.clone()));
                    }
                }
                Ok(Some(project.path))
            })
            .await
            .ok()
            .flatten()
    }
}

#[cfg(test)]
impl AppCtx {
    /// Build a fully-real `Arc<AppCtx>` for route unit tests over an in-memory DB
    /// and real service collaborators (no mocks), with `chat_manager: None` — the
    /// same surface the integration harness assembles. Route tests seed via
    /// `ctx.db` and call handlers directly (the route modules are mounted by the
    /// next task, so `build_app` does not yet include them).
    pub(crate) fn test_ctx() -> Arc<AppCtx> {
        use dashmap::DashMap;
        use mainframe_db::DatabaseManager;

        let db = crate::db::Db::spawn(|| DatabaseManager::open(std::path::Path::new(":memory:")))
            .expect("open in-memory db");
        let (broadcast, _keep) = broadcast::channel::<DaemonEvent>(64);
        std::mem::forget(_keep);
        let watcher = FileWatcherService::new(|_| {});
        Arc::new(AppCtx {
            db,
            git: GitFactory,
            services: Services {
                attachments: Arc::new(AttachmentStore::new(
                    std::env::temp_dir().join("mf-routes-test"),
                )),
                push: Arc::new(PushService::new()),
                watcher: Arc::new(watcher),
            },
            broadcast,
            adapter_registry: Arc::new(AdapterRegistry::new()),
            background_tasks: Arc::new(BackgroundTaskTracker::new()),
            chat_manager: None,
            launch_registry: None,
            tunnel_manager: None,
            lsp_manager: None,
            plugin_manager: None,
            automations: None,
            quota: None,
            data_dir: std::env::temp_dir(),
            version: "0.0.0-test".into(),
            port: 0,
            auth_secret: None,
            resolved_path: ResolvedPath::from_value("/usr/bin:/bin"),
            tunnel_url: Arc::new(RwLock::new(None)),
            ws_clients: Arc::new(DashMap::new()),
        })
    }
}

// PORT STATUS: src/server/http.ts (ctx assembly) + WebSocketManager deps
// confidence: medium
// todos: 1
// notes: Narrowed to Phase-3 collaborators, extended in Task 4.6a with the
// chat-facing handles: `adapter_registry` (AdapterRegistry) + `background_tasks`
// (BackgroundTaskTracker) are concrete Arcs (cheap ::new); `chat_manager` is
// Option<Arc<ChatManager>> because ChatManager::new needs a full ChatManagerDeps
// impl the test harness cannot build — the daemon boot (next task) sets Some(..).
// Task 5.5 wired the remaining managers: launch_registry, tunnel_manager,
// lsp_manager, plugin_manager are Option<Arc<..>> (Some in the daemon boot, None in
// the route-unit harness). `port` backs the tunnel start route; `tunnel_url` is now
// interior-mutable (Arc<RwLock<..>>) so setTunnelUrl + the boot tunnel start update
// what /health reports. `effective_path` ports getEffectivePath over the Db actor.
// workflows stays deliberately unported (SCOPE DECISION 2026-07-10). `Services`
// bundles the §2.4 handles that routes/WS need (attachments, push, file watcher).
