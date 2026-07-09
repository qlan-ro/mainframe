//! `AppCtx` — the Arc-shared application context every route module and the WS
//! layer read. Mirrors the `ctx` object assembled in `src/server/http.ts` plus
//! the `HttpServerDeps` / WebSocketManager collaborators, narrowed to the
//! Phase-3 surface (chat/adapter/launch/plugin/workflow managers are Phase 4/5).

use std::path::PathBuf;
use std::sync::Arc;

use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use crate::db::Db;
use crate::websocket::WsClients;

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
    pub data_dir: PathBuf,
    pub version: String,
    /// `AUTH_TOKEN_SECRET`. `None` disables auth entirely (middleware + WS
    /// upgrade become no-ops) — the exact `whenSecretUnset` contract.
    pub auth_secret: Option<String>,
    /// `/health`'s `tunnelUrl`. The `setTunnelUrl` mutator lives on the tunnel
    /// routes (Phase 4/5); Phase 3 always reports the boot value (`None`).
    pub tunnel_url: Option<String>,
}

// PORT STATUS: src/server/http.ts (ctx assembly) + WebSocketManager deps
// confidence: medium
// todos: 1
// notes: Narrowed to Phase-3 collaborators. TODO(port-phase4/5): chats
// (ChatManager), adapters (AdapterRegistry), launchRegistry, pluginManager,
// tunnelManager, lspManager, backgroundTasks, workflows are added here as the
// later phases land. `tunnel_url` is immutable in Phase 3 (setTunnelUrl seam on
// the Phase-4 tunnel routes). `Services` bundles the §2.4 handles that Phase-3
// routes/WS need (attachments, push, file watcher).
