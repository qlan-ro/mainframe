//! `AppCtx` — the Arc-shared application context every route module and the WS
//! layer read. Mirrors the `ctx` object assembled in `src/server/http.ts` plus
//! the `HttpServerDeps` / WebSocketManager collaborators, narrowed to the
//! Phase-3 surface (chat/adapter/launch/plugin/workflow managers are Phase 4/5).

use std::path::PathBuf;
use std::sync::Arc;

use mainframe_adapter_api::AdapterRegistry;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_chat::chat_manager::ChatManager;
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use crate::db::Db;
use crate::websocket::WsClients;

/// The `defaultRun` process runner, as the `Runner` trait resolve-executable
/// injects. `resolveAdapterExecutable` (the settings `resolvedExecutable`
/// enrichment and the daemon's refresh deps) takes `&dyn Runner`; this is the
/// single production impl over `default_run` (`execFile` + 5s timeout).
pub struct DefaultRunner;

impl mainframe_adapter_api::resolve_executable::Runner for DefaultRunner {
    fn run(
        &self,
        cmd: String,
        args: Vec<String>,
        timeout_ms: Option<u64>,
    ) -> mainframe_adapter_api::BoxFuture<'_, mainframe_adapter_api::RunResult> {
        Box::pin(async move {
            mainframe_adapter_api::resolve_executable::default_run(&cmd, &args, timeout_ms).await
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
    pub data_dir: PathBuf,
    pub version: String,
    /// `AUTH_TOKEN_SECRET`. `None` disables auth entirely (middleware + WS
    /// upgrade become no-ops) — the exact `whenSecretUnset` contract.
    pub auth_secret: Option<String>,
    /// `/health`'s `tunnelUrl`. The `setTunnelUrl` mutator lives on the tunnel
    /// routes (Phase 4/5); Phase 3 always reports the boot value (`None`).
    pub tunnel_url: Option<String>,
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
            data_dir: std::env::temp_dir(),
            version: "0.0.0-test".into(),
            auth_secret: None,
            tunnel_url: None,
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
// TODO(port-phase4/5): launchRegistry, pluginManager, tunnelManager, lspManager,
// workflows land here as later phases arrive. `tunnel_url` is immutable in Phase 3
// (setTunnelUrl seam on the Phase-4 tunnel routes). `Services` bundles the §2.4
// handles that Phase-3 routes/WS need (attachments, push, file watcher).
