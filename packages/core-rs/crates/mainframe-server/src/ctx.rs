//! `AppCtx` — the Arc-shared application context every route module and the WS
//! layer read.

use mainframe_types::sync::RwLockExt as _;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use mainframe_adapter_api::AdapterRegistry;
use mainframe_automations::AutomationsEngine;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_chat::chat_manager::ChatManager;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_launch::{LaunchRegistry, PortTunnelRegistry, TunnelManager};
use mainframe_lsp::LspManager;
use mainframe_orchestration::OrchestrationService;
use mainframe_plugins::PluginManager;
use mainframe_runtime::ResolvedPath;
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_services::quota::QuotaService;
use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;

use crate::acp_ws::FacadeHub;
use crate::db::Db;
use crate::websocket::WsClients;

/// The default process runner, as the `Runner` trait resolve-executable
/// injects. `resolve_adapter_executable` (the settings `resolvedExecutable`
/// enrichment and the daemon's refresh deps) takes `&dyn Runner`; this is the
/// single production impl over `default_run` (spawn + 5s default timeout).
///
/// Carries the boot-resolved login-shell `PATH` so `which`/`where` detection and
/// version probes find CLIs outside the packaged app's bare `PATH`.
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
    /// Build a `GitService` scoped to `project_path`; route handlers call this
    /// per request.
    pub fn for_project(&self, project_path: impl Into<String>) -> mainframe_git::GitService {
        mainframe_git::GitService::for_project(project_path)
    }
}

/// The cross-cutting daemon service handles. `commands` and
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
    /// layer subscribes and applies per-chat gating.
    pub broadcast: broadcast::Sender<DaemonEvent>,
    /// The live WS client registry, consulted by the broadcast fan-out and
    /// populated per connection.
    pub ws_clients: WsClients,
    /// The ACP facade hub: the `/acp/{profile}` connection registry plus the
    /// `ChatSurface` fan-out that streams chat-surface events to attached
    /// facade sessions. The same `Arc` is attached to the
    /// `ChatManager` at boot (`build_chat_manager`).
    pub facade_hub: Arc<FacadeHub>,
    /// Heartbeat cadence advertised in `initialize`'s `_meta` and used by the
    /// facade socket loop. Production default is
    /// `mainframe_acp::DEFAULT_HEARTBEAT_INTERVAL_MS`; test harnesses shrink
    /// it to stay inside their timeout budget.
    pub facade_heartbeat_interval_ms: u64,
    /// The `AdapterRegistry` (contract `adapters` handle). Backs `GET /api/adapters`
    /// (`list()` with installed/version probing) and the agents/skills routes'
    /// existence check. Cheap to construct (`AdapterRegistry::new()`), so it is a
    /// concrete handle rather than an `Option`.
    pub adapter_registry: Arc<AdapterRegistry>,
    /// The `BackgroundTaskTracker` (contract `backgroundTasks` handle). Backs the
    /// `/api/chats/:chatId/background-tasks*` routes. Cheap to construct, so concrete.
    pub background_tasks: Arc<BackgroundTaskTracker>,
    /// The `ClaudeWorkflowStore` (retained in-memory Claude workflow runs). Backs
    /// the chat-history `workflowRuns` fold. Cheap to construct, so concrete.
    pub claude_workflows: Arc<ClaudeWorkflowStore>,
    /// The `ChatManager` (contract `chats` handle). `Some` in the daemon boot
    /// (`build_chat_manager`) and in `test_ctx_with_chat_manager`; `None` in the
    /// plain route-unit harness (`test_ctx`). Chat route handlers gate on `Some`
    /// and fall back to the failure-path envelope when absent.
    pub chat_manager: Option<Arc<ChatManager>>,
    /// The per-project `LaunchRegistry` (contract `launchRegistry` handle). Backs
    /// the `/api/projects/:id/launch/*` routes. `None` in the route-unit harness.
    pub launch_registry: Option<Arc<LaunchRegistry>>,
    /// The cloudflared `TunnelManager` (contract `tunnelManager` handle). Backs the
    /// `/api/tunnel/*` routes. `None` in the route-unit harness.
    pub tunnel_manager: Option<Arc<TunnelManager>>,
    /// Per-port quick tunnels for the localhost chips, sharing the
    /// `TunnelManager` above. `Some` whenever `tunnel_manager` is.
    pub port_tunnels: Option<Arc<PortTunnelRegistry>>,
    /// The `LspManager` (contract `lspManager` handle). Backs `GET
    /// /api/lsp/languages` and the `/lsp/:projectId/:language` WS upgrade. `None`
    /// in the route-unit harness.
    pub lsp_manager: Option<Arc<LspManager>>,
    /// The `PluginManager` (contract `pluginManager` handle). Its router is nested
    /// under `/api/plugins` by `build_app`. `None` in the route-unit harness.
    pub plugin_manager: Option<Arc<PluginManager>>,
    /// The Automations v2 engine. `Some` in the daemon boot; `None` in the
    /// route-unit harness — automation routes answer 503 with
    /// "automation service not available" while absent.
    pub automations: Option<Arc<AutomationsEngine>>,
    /// The orchestration MCP server behind `POST /mcp`. `Some` in the daemon
    /// boot; `None` in harnesses that do not exercise it (the route answers
    /// 503 while absent).
    pub orchestration: Option<Arc<OrchestrationService>>,
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
    /// route that spawns a CLI.
    pub resolved_path: ResolvedPath,
    /// `/health`'s `tunnelUrl`. Interior-mutable so the tunnel routes' `setTunnelUrl`
    /// and the boot-time daemon-tunnel start can update what `/health` reports.
    pub tunnel_url: Arc<RwLock<Option<String>>>,
}

impl AppCtx {
    /// Read the current `/health` tunnel URL.
    pub fn tunnel_url(&self) -> Option<String> {
        self.tunnel_url.read_recover().clone()
    }

    /// The mutator the tunnel routes call after start/stop.
    pub fn set_tunnel_url(&self, url: Option<String>) {
        *self.tunnel_url.write_recover() = url;
    }

    /// Worktree-aware effective path: the chat's worktree when the chatId points
    /// to a live worktree of this project; the project root otherwise. `None` on an
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
    /// `ctx.db` and call handlers directly.
    pub(crate) fn test_ctx() -> Arc<AppCtx> {
        crate::chat_test_support::test_ctx()
    }

    /// Like [`Self::test_ctx`], but with a REAL `ChatManager` (via
    /// `build_chat_manager`, same production `DaemonChatDeps` the daemon boot
    /// wires) so route tests can reach the create/discard/archive/unarchive/
    /// remove-project success paths those routes gate on `chat_manager` being
    /// `Some` — `Self::test_ctx`'s `chat_manager: None` can
    /// only reach each route's "unavailable" fallback. Register an adapter on
    /// the returned ctx's `adapter_registry` before creating a chat under its
    /// id (see `chat_test_support::StubAdapter`).
    pub(crate) fn test_ctx_with_chat_manager() -> Arc<AppCtx> {
        crate::chat_test_support::test_ctx_with_chat_manager()
    }

    /// Like [`Self::test_ctx_with_chat_manager`], with the orchestration MCP
    /// service attached as the daemon boot attaches it.
    pub(crate) fn test_ctx_with_orchestration() -> Arc<AppCtx> {
        crate::chat_test_support::test_ctx_with_orchestration()
    }
}

#[cfg(test)]
mod poisoned_lock_tests {
    use super::*;

    #[test]
    fn tunnel_url_write_survives_a_poisoned_lock() {
        let ctx = AppCtx::test_ctx();
        std::thread::scope(|scope| {
            assert!(
                scope
                    .spawn(|| {
                        let _guard = ctx.tunnel_url.write().unwrap();
                        panic!("poison tunnel URL");
                    })
                    .join()
                    .is_err()
            );
        });

        ctx.set_tunnel_url(Some("https://example.test".to_string()));
        assert_eq!(ctx.tunnel_url().as_deref(), Some("https://example.test"));
    }
}
