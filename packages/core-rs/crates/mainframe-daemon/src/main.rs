//! Ported from `src/index.ts`, `src/cli/*` (packages/core).
//!
//! Phase-4 boot: enrichPath → config → auth secret → DB (actor handle) →
//! BackgroundTaskTracker → AdapterRegistry (claude+codex, static seed, refresh) →
//! ChatManager → plugins → LSP → services → broadcast → HTTP/WS server, then the
//! post-bind stray-child sweep + background-task reconcile + worktree-relationship
//! backfill + the liveness scheduler + the adapter catalog refresh, with graceful
//! SIGINT/SIGTERM shutdown. Tunnel + launch share one `FileChildRegistry`
//! (managed-children.json) so a crashed daemon's next boot reaps every leaked
//! child (clusters B/F); a panic hook reaps adapter + tunnel children, and a
//! 200ms flush precedes any fatal exit. Workflows stay unported (SCOPE DECISION).
#![forbid(unsafe_code)]

mod builtin_plugins;
mod cli;
mod plugin_host_db;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use crate::plugin_host_db::DaemonPluginHostDb;
use mainframe_adapter_api::resolve_executable::{
    ResolverDeps, SettingsWriter, resolve_adapter_executable,
};
use mainframe_adapter_api::{AdapterRegistry, BoxFuture, RefreshDeps, RunResult};
use mainframe_adapter_claude::adapter::ClaudeAdapter;
use mainframe_adapter_codex::CodexAdapter;
use mainframe_background_tasks::liveness::{LivenessDeps, start_liveness_scheduler};
use mainframe_background_tasks::reconcile::{
    ReconcileDb, ReconcileDeps, reconcile_background_tasks,
};
use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskEvent};
use mainframe_launch::{
    BroadcastFn, ChildRegistryPort, FileChildRegistry, LaunchRegistry, ResolveCloudflaredDeps,
    TunnelManager, TunnelManagerOptions, TunnelStartOptions, default_sweep_deps,
    resolve_cloudflared_path, sweep_stray_children,
};
use mainframe_lsp::{LspManager, LspRegistry};
use mainframe_plugins::event_bus::PublicDaemonBus;
use mainframe_plugins::manager::PluginManagerDeps;
use mainframe_plugins::{EmitSink, PluginHostDb, PluginManager};
use mainframe_server::ctx::{AppCtx, DefaultRunner, GitFactory, Services};
use mainframe_server::db::Db;
use mainframe_server::{
    RegistryLaunchStopper, build_app, build_automations_engine, build_chat_manager,
    spawn_broadcast_pump,
};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_types::chat::Chat;
use mainframe_types::events::DaemonEvent;
use tokio::signal;
use tokio::sync::broadcast;
use tracing::info;

const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Fan-out channel depth. Slow WS clients that lag past this are warned and
/// resynced on their next event (see websocket::spawn_broadcast_pump).
const BROADCAST_CAPACITY: usize = 1024;

#[tokio::main]
async fn main() {
    // `--version`/`version` is answered before logging init (early-flags.ts): no
    // pino/logger noise on stdout, no daemon graph loaded. `pair`/`status` are thin
    // HTTP clients against the running daemon.
    match std::env::args().nth(1).as_deref() {
        Some("--version") | Some("-v") | Some("version") => {
            println!("mainframe {DAEMON_VERSION}");
            return;
        }
        Some("pair") => return cli::pair::run_pair().await,
        Some("status") => return cli::status::run_status().await,
        Some("update") => {
            // update.ts (self-update) is a packaging concern, not part of Task 5.5.
            eprintln!("  `mainframe update` is not available in this build.");
            std::process::exit(1);
        }
        _ => {}
    }
    run_daemon().await;
}

/// The daemon boot (`main()` in `index.ts`).
async fn run_daemon() {
    let _log_guard = mainframe_runtime::logging::init();

    // Resolve the login-shell PATH once at boot and thread it into every child
    // spawn (adapters, title generation, LSP, launch, background-task probes).
    // The TS twin mutated `process.env.PATH`; edition 2024 forbids that under
    // `#![forbid(unsafe_code)]`, so the value is passed explicitly instead.
    let resolved_path = mainframe_runtime::ResolvedPath::resolve();
    mainframe_background_tasks::spawn_env::set_resolved_path(resolved_path.as_str());

    let config = match mainframe_runtime::config::get_config() {
        Ok(config) => config,
        Err(err) => fatal("failed to load config", &err),
    };
    // ensureAuthSecret(): generates + persists a secret if none exists. The TS
    // daemon then sets process.env.AUTH_TOKEN_SECRET; env mutation is `unsafe`
    // under edition 2024, so the secret is threaded through AppCtx instead.
    let auth_secret = match mainframe_runtime::config::ensure_auth_secret() {
        Ok(secret) => Some(secret),
        Err(err) => fatal("failed to resolve auth secret", &err),
    };
    let data_dir = PathBuf::from(&config.data_dir);
    let port = config.port;
    info!(data_dir = %data_dir.display(), "data directory");

    let db = match Db::spawn(mainframe_db::DatabaseManager::new) {
        Ok(db) => db,
        Err(err) => fatal("failed to open database", &err),
    };

    let (broadcast, _keepalive_rx) =
        tokio::sync::broadcast::channel::<DaemonEvent>(BROADCAST_CAPACITY);

    // File-change events are broadcast like any other daemon event.
    let watcher_tx = broadcast.clone();
    let watcher = FileWatcherService::new(move |event| {
        let _ = watcher_tx.send(event);
    });

    // A fire-and-forget `BroadcastFn` over the same channel (index.ts's late-bound
    // `broadcastEvent` closure) — launch/tunnel events fan out to WS via the pump.
    let event_bcast = broadcast.clone();
    let on_event: BroadcastFn = Arc::new(move |event| {
        let _ = event_bcast.send(event);
    });

    // One pidfile registry, shared by the tunnel and launch managers (a `kind`
    // field distinguishes their records), so a single startup sweep can reap every
    // child a crashed daemon leaked (index.ts: `new FileChildRegistry(...)`).
    let child_registry: Arc<dyn ChildRegistryPort> = Arc::new(FileChildRegistry::new(
        data_dir
            .join("managed-children.json")
            .to_string_lossy()
            .into_owned(),
    ));
    // Resolve cloudflared to an absolute path so a spawned tunnel is recorded (and
    // later reaped) by exact binary path, never a bare name. The TS twin scanned
    // the enriched `process.env.PATH`; the Rust daemon threads the login-shell PATH
    // explicitly, so scan that same resolved value.
    let cloudflared_path = resolve_cloudflared_path(ResolveCloudflaredDeps {
        path: Some(resolved_path.as_str().to_string()),
        ..Default::default()
    })
    .await;

    // Tunnel + launch managers (index.ts: new TunnelManager → new LaunchRegistry).
    // The registry shares the tunnel manager so preview launches can expose URLs;
    // both share the one child registry for crash-recovery reaping.
    let tunnel_manager = Arc::new(
        TunnelManager::with_options(
            Some(Arc::clone(&on_event)),
            TunnelManagerOptions {
                registry: Some(Arc::clone(&child_registry)),
                cloudflared_path,
            },
        )
        .with_resolved_path(resolved_path.as_str()),
    );
    let launch_registry = Arc::new(
        LaunchRegistry::new(Arc::clone(&on_event), Some(Arc::clone(&tunnel_manager)))
            .with_child_registry(Arc::clone(&child_registry))
            .with_resolved_path(resolved_path.as_str()),
    );

    // Registries + adapters. ClaudeAdapter needs the tracker (background-task
    // ownership); both adapters register before the static snapshot seed so
    // `GET /api/adapters` serves instantly without a CLI spawn.
    let background_tasks = Arc::new(BackgroundTaskTracker::new());
    let adapters = Arc::new(AdapterRegistry::new());
    adapters.register(Arc::new(ClaudeAdapter::new(
        Arc::clone(&background_tasks),
        resolved_path.clone(),
    )));
    adapters.register(Arc::new(CodexAdapter::new(resolved_path.clone())));
    adapters.seed_static_snapshots();

    // Forward tracker emissions through the broadcast (index.ts wires
    // background_task.started/updated/ended onto broadcastEvent).
    spawn_task_event_bridge(Arc::clone(&background_tasks), broadcast.clone());

    // uncaughtException cleanup (index.ts `process.on('uncaughtException')`): a
    // panic is Rust's uncaught exception. Kill adapter children and — crucially —
    // the tracked cloudflared children, or they orphan and re-parent to PID 1.
    // Chained ahead of the default hook so the panic still prints and aborts.
    // (launchRegistry's async stopAll can't be awaited from a sync hook; the
    // post-bind startup sweep reaps any launch children a panic leaks.)
    {
        let panic_adapters = Arc::clone(&adapters);
        let panic_tunnel = Arc::clone(&tunnel_manager);
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            tracing::error!(panic = %info, "Uncaught exception");
            panic_adapters.kill_all();
            panic_tunnel.stop_all();
            default_hook(info);
        }));
    }

    // Configure the refresh BEFORE server start so no request triggers an
    // unconfigured probe. resolveExecutablePath reads the persisted provider path
    // via the DB actor, then falls back to `which` detection through the shared
    // resolver. TODO(port): backfillAdapterExecutables (persisting detected paths)
    // needs a sync `SettingsWriter` write bridge to the async DB actor — not wired,
    // so refresh re-detects each run instead of reading a backfilled path.
    adapters.configure_refresh(Arc::new(DaemonRefreshDeps {
        db: db.clone(),
        broadcast: broadcast.clone(),
        resolved_path: resolved_path.clone(),
    }));

    let services = Services {
        attachments: Arc::new(AttachmentStore::new(data_dir.join("attachments"))),
        push: Arc::new(PushService::new()),
        watcher: Arc::new(watcher),
    };

    // ChatManager: constructed after the AdapterRegistry + BackgroundTaskTracker
    // (its DB accessors reach the single WAL connection through the Db actor's
    // sync bridge; launch/todos/notifications wire through the ported services and
    // the LaunchStopper seam). Boot-order match: `new ChatManager(...)` then
    // `recoverStaleWorkingState()` in index.ts.
    let chats = build_chat_manager(
        db.clone(),
        Arc::clone(&adapters),
        Arc::clone(&background_tasks),
        Arc::clone(&services.attachments),
        Arc::clone(&services.push),
        GitFactory,
        broadcast.clone(),
        Arc::new(RegistryLaunchStopper::new(Arc::clone(&launch_registry))),
        resolved_path.clone(),
    );
    // No in-memory CLI sessions survive a restart, so reset any persisted
    // processState:'working' (orphaned by the previous shutdown/crash) to 'idle'.
    chats.recover_stale_working_state();

    // Automations v2 engine (T9.2): built over its own automations.db after the
    // ChatManager exists (the agent port drives chats). A build failure logs and
    // leaves `None` — routes answer 503, everything else serves.
    let automations = build_automations_engine(
        db.clone(),
        Arc::clone(&chats),
        broadcast.clone(),
        Arc::clone(&services.push),
        GitFactory,
        &data_dir,
    )
    .await;
    // Boot reconcile (Node service.start): re-advance in-flight runs, re-attach
    // durable agent watches, and arm the schedule sweep + event triggers. A
    // failure logs and leaves the routes serving — same posture as a build
    // failure. Bounded: each live run advances only to its next park/terminal.
    if let Some(automations) = &automations
        && let Err(err) = automations.start().await
    {
        tracing::error!(%err, "failed to start the automations engine");
    }

    // LSP: registry (bundled server configs) + the per-(project,language) manager.
    // Constructed in `createServerManager` in the TS; the Rust daemon owns it.
    // The TS twin resolved bundled servers (typescript-language-server, pyright)
    // via `require.resolve` + `process.execPath`; the Rust daemon has no Node
    // module resolver, so the packaging layer injects the bundled `node` binary +
    // `node_modules` root through env. When unset (dev / run-from-source) bundled
    // TS/Python resolve to None and only external servers (jdtls) spawn — matching
    // the old behaviour. TODO(port): confirm these names against the finalized
    // Tauri sidecar layout and verify on a packaged macOS/Windows build.
    let lsp_registry = {
        let registry = LspRegistry::new().with_resolved_path(resolved_path.as_str());
        match (
            std::env::var("MAINFRAME_BUNDLED_NODE")
                .ok()
                .filter(|s| !s.is_empty()),
            std::env::var("MAINFRAME_BUNDLED_LSP_ROOT")
                .ok()
                .filter(|s| !s.is_empty()),
        ) {
            (Some(node), Some(root)) => {
                info!(node, root, "LSP: bundled node servers configured");
                registry.with_bundled(node, root)
            }
            _ => registry,
        }
    };
    let lsp_manager = Arc::new(LspManager::new(Arc::new(lsp_registry)));

    // PluginManager (index.ts: new PluginManager + loadBuiltin claude/codex/todos).
    // Adapters are registered directly on the AdapterRegistry above, so the plugin
    // deps take `adapters: None`; the builtin manifests populate GET /api/plugins.
    let daemon_bus = Arc::new(PublicDaemonBus::new());
    let plugin_emit_bcast = broadcast.clone();
    let plugin_emit: EmitSink = Arc::new(move |event| {
        let _ = plugin_emit_bcast.send(event);
    });
    let plugin_host_db: Arc<dyn PluginHostDb> = Arc::new(DaemonPluginHostDb::new(db.clone()));
    let plugin_manager = Arc::new(PluginManager::new(PluginManagerDeps {
        host_db: plugin_host_db,
        daemon_bus,
        emit: plugin_emit,
        adapters: None,
    }));
    if let Err(err) = builtin_plugins::load_builtin_plugins(&plugin_manager, &data_dir).await {
        tracing::error!(%err, "failed to load builtin plugins");
    }
    // index.ts also calls `pluginManager.loadAll()` here to discover user-installed
    // plugins under `data_dir/plugins`. That on-disk discovery path (the `_require`
    // JS loader + the consent/trust flow) is a deliberate v1 omission per §2.9/§5
    // (see manager.rs) — the Rust PluginManager is builtin-only, so there is no
    // `load_all` to call. User-installed plugins are not loaded in v1.

    let ctx = Arc::new(AppCtx {
        db: db.clone(),
        git: GitFactory,
        services,
        broadcast: broadcast.clone(),
        data_dir,
        version: DAEMON_VERSION.to_string(),
        port,
        auth_secret,
        resolved_path: resolved_path.clone(),
        tunnel_url: Arc::new(RwLock::new(None)),
        ws_clients: Arc::new(dashmap::DashMap::new()),
        adapter_registry: Arc::clone(&adapters),
        background_tasks: Arc::clone(&background_tasks),
        chat_manager: Some(Arc::clone(&chats)),
        launch_registry: Some(Arc::clone(&launch_registry)),
        tunnel_manager: Some(Arc::clone(&tunnel_manager)),
        lsp_manager: Some(Arc::clone(&lsp_manager)),
        plugin_manager: Some(Arc::clone(&plugin_manager)),
        automations: automations.clone(),
    });

    spawn_broadcast_pump(Arc::clone(&ctx));

    let app = build_app(Arc::clone(&ctx));

    // Loopback only — matches `httpServer.listen(port, '127.0.0.1')` in index.ts.
    // Binding all interfaces would expose the daemon on every NIC/LAN, and with
    // `AUTH_TOKEN_SECRET` unset the auth gate is a no-op. Only loopback and the
    // local cloudflared tunnel may reach the daemon.
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) => fatal("failed to bind daemon listener", &err),
    };
    info!(%addr, version = DAEMON_VERSION, "mainframe-daemon listening");

    // Reap tunnel AND launch children a previous daemon crash/kill orphaned,
    // pruning their records. This MUST run after the port bind: the bind is the
    // daemon's only single-instance guard, so a duplicate launch against the same
    // data dir fails on bind above instead of sweeping the live daemon's children.
    // It still precedes every tunnel spawn (the daemon tunnel below; preview and
    // launch children are user-triggered). The sweep logs per-entry internally.
    let sweep = sweep_stray_children(child_registry.as_ref(), &default_sweep_deps()).await;
    if sweep.reaped > 0 || sweep.skipped > 0 {
        info!(
            total = sweep.total,
            reaped = sweep.reaped,
            skipped = sweep.skipped,
            "stray child process sweep complete"
        );
    }

    // Post-listen boot (index.ts runs these after server.start()): the liveness
    // sweep scheduler, a non-blocking background-task reconcile, and the adapter
    // catalog refresh. All are fire-and-forget with the same warn-on-failure.
    let liveness = start_liveness_scheduler(LivenessDeps {
        tracker: Arc::clone(&background_tasks),
        interval_ms: None,
    });
    spawn_reconcile(db.clone(), Arc::clone(&background_tasks));
    spawn_worktree_backfill(db.clone());

    // allowRefresh() gates a pre-configure probe; refreshAll enriches
    // installed/version/models per adapter and emits. Non-blocking.
    adapters.allow_refresh();
    let refresh_adapters = Arc::clone(&adapters);
    tokio::spawn(async move {
        refresh_adapters.refresh_all().await;
    });

    // Daemon tunnel (index.ts): auto-start when configured (opt-in), else adopt a
    // pre-configured URL. Failure is non-fatal — the daemon serves loopback anyway.
    if config.tunnel == Some(true) {
        let options = config.tunnel_token.clone().map(|token| TunnelStartOptions {
            token: Some(token),
            url: config.tunnel_url.clone(),
        });
        match tunnel_manager.start(port, "daemon", options).await {
            Ok(url) => {
                ctx.set_tunnel_url(Some(url.clone()));
                info!(tunnel_url = %url, "Daemon tunnel started");
                tracing::warn!(
                    "Daemon is publicly accessible via tunnel — do not share this URL in untrusted environments"
                );
            }
            Err(err) => {
                tracing::error!(%err, "Failed to start daemon tunnel — continuing without tunnel");
            }
        }
    } else if let Some(url) = config.tunnel_url.clone() {
        ctx.set_tunnel_url(Some(url.clone()));
        info!(tunnel_url = %url, "Using configured tunnel URL (no auto-start)");
    }

    info!("Daemon ready");

    let service = app.into_make_service_with_connect_info::<SocketAddr>();
    if let Err(err) = axum::serve(listener, service)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        tracing::error!(%err, "daemon server exited with error");
        flush_and_exit(1);
    }

    // Ordered shutdown (index.ts `shutdown`): automations.stop() → chats.dispose →
    // plugins.unloadAll → adapters.killAll → launch.stopAll → tunnel.stopAll →
    // liveness.stop → server.stop → db.close. The HTTP server is already stopped
    // (axum::serve returned above), and lspManager.shutdownAll is part of that
    // server-stop step in the TS.
    info!("Shutting down...");
    if let Some(automations) = &automations {
        automations.stop();
    }
    chats.dispose();
    plugin_manager.unload_all();
    adapters.kill_all();
    launch_registry.stop_all().await;
    tunnel_manager.stop_all();
    liveness.stop();
    lsp_manager.shutdown_all().await;
    // `db` (the actor thread) closes when the last `Db` handle drops at exit.
}

/// Drain the tracker's `TaskEvent` broadcast and re-emit as daemon
/// `background_task.started`/`updated`/`ended` events. Mirrors the three
/// `backgroundTasks.on` forwarders in index.ts.
fn spawn_task_event_bridge(
    tracker: Arc<BackgroundTaskTracker>,
    bus: broadcast::Sender<DaemonEvent>,
) {
    let mut rx = tracker.subscribe();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(TaskEvent::Started { chat_id, task }) => {
                    let _ = bus.send(DaemonEvent::BackgroundTaskStarted { chat_id, task });
                }
                Ok(TaskEvent::Updated { chat_id, task }) => {
                    let _ = bus.send(DaemonEvent::BackgroundTaskUpdated { chat_id, task });
                }
                Ok(TaskEvent::Ended { chat_id, task }) => {
                    let _ = bus.send(DaemonEvent::BackgroundTaskEnded { chat_id, task });
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(dropped = n, "task-event bridge lagged");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Non-blocking background-task reconcile (`reconcileBackgroundTasks(...).catch`).
/// `ReconcileDb` is synchronous, but the only DB handle is the async actor, so a
/// read-only snapshot (all chats + project paths) is pre-fetched on the actor and
/// reconcile runs over that snapshot — reconcile only reads, never writes, so this
/// is faithful (no sync-DB bridge needed).
fn spawn_reconcile(db: Db, tracker: Arc<BackgroundTaskTracker>) {
    tokio::spawn(async move {
        let snapshot = match db
            .call(|d| {
                let chats = d.chats.list_all()?;
                let projects = d.projects.list()?;
                Ok((chats, projects))
            })
            .await
        {
            Ok((chats, projects)) => SnapshotReconcileDb {
                chats,
                project_paths: projects.into_iter().map(|p| (p.id, p.path)).collect(),
            },
            Err(err) => {
                tracing::warn!(%err, "Background task reconciliation failed");
                return;
            }
        };
        reconcile_background_tasks(ReconcileDeps {
            tracker: &tracker,
            db: &snapshot,
            spool_root: None,
            validator: None,
        })
        .await;
    });
}

/// Non-blocking worktree relationship backfill (index.ts `backfillWorktreeRelationships`).
/// Existing worktree-derived projects must get their `parent_project_id` linked at
/// boot. The git enumeration is async and can't run inside the DB actor's sync
/// closure, so the projects are read on the actor, the parent links computed via
/// `git worktree list`, then the writes applied back on the actor. Fire-and-forget:
/// a failure must never block serving requests.
fn spawn_worktree_backfill(db: Db) {
    tokio::spawn(async move {
        let projects = match db.call(|d| d.projects.list()).await {
            Ok(projects) => projects,
            Err(err) => {
                tracing::warn!(%err, "Worktree relationship backfill failed");
                return;
            }
        };
        let links = mainframe_services::workspace::compute_worktree_parent_links(&projects).await;
        if links.is_empty() {
            return;
        }
        let result = db
            .call(move |d| {
                for (child_id, parent_id) in &links {
                    tracing::info!(
                        module = "worktree-backfill",
                        child_id = %child_id,
                        parent_id = %parent_id,
                        "Backfilling worktree relationship"
                    );
                    d.projects.set_parent_project(child_id, parent_id)?;
                }
                Ok(())
            })
            .await;
        if let Err(err) = result {
            tracing::warn!(%err, "Worktree relationship backfill failed");
        }
    });
}

/// Pre-fetched, read-only `ReconcileDb` snapshot (see `spawn_reconcile`).
struct SnapshotReconcileDb {
    chats: Vec<Chat>,
    project_paths: HashMap<String, String>,
}

impl ReconcileDb for SnapshotReconcileDb {
    fn chats_list_all(&self) -> Vec<Chat> {
        self.chats.clone()
    }
    fn project_path(&self, id: &str) -> Option<String> {
        self.project_paths.get(id).cloned()
    }
}

/// The adapter-registry refresh injection (index.ts `configureRefresh`).
struct DaemonRefreshDeps {
    db: Db,
    broadcast: broadcast::Sender<DaemonEvent>,
    resolved_path: mainframe_runtime::ResolvedPath,
}

impl RefreshDeps for DaemonRefreshDeps {
    fn resolve_executable_path(&self, adapter_id: String) -> BoxFuture<'_, Option<String>> {
        let db = self.db.clone();
        let runner = DefaultRunner::new(self.resolved_path.clone());
        Box::pin(async move {
            // Read the persisted provider path on the DB actor, snapshot it into a
            // one-key SettingsWriter, then run the shared resolver (which falls
            // back to `which` detection when unset). resolveAdapterExecutable never
            // writes, so a read snapshot is faithful.
            let key = format!("{adapter_id}.executablePath");
            let lookup_key = key.clone();
            let configured = db
                .call(move |d| Ok(d.settings.get("provider", &lookup_key).ok().flatten()))
                .await
                .ok()
                .flatten();
            let settings = OneSetting {
                category: "provider".to_string(),
                key,
                value: configured,
            };
            let resolved = resolve_adapter_executable(
                &adapter_id,
                &ResolverDeps {
                    settings: &settings,
                    run: &runner,
                    platform: None,
                },
            )
            .await;
            resolved.valid.then_some(resolved.path)
        })
    }

    fn run(
        &self,
        cmd: String,
        args: Vec<String>,
        timeout_ms: Option<u64>,
    ) -> BoxFuture<'_, RunResult> {
        let path = self.resolved_path.clone();
        Box::pin(async move {
            mainframe_adapter_api::resolve_executable::default_run(
                &cmd,
                &args,
                timeout_ms,
                Some(path.as_str()),
            )
            .await
        })
    }

    fn emit_event(&self, event: DaemonEvent) {
        let _ = self.broadcast.send(event);
    }
}

/// A single-entry read-only `SettingsWriter` snapshot: `get` returns the
/// pre-fetched value for its one `(category, key)`, `set` is a no-op (the refresh
/// resolve path never persists). Bridges the sync `SettingsWriter` trait to a
/// value already read off the async DB actor.
struct OneSetting {
    category: String,
    key: String,
    value: Option<String>,
}

impl SettingsWriter for OneSetting {
    fn get(&self, category: &str, key: &str) -> Option<String> {
        if category == self.category && key == self.key {
            self.value.clone()
        } else {
            None
        }
    }
    fn set(&self, _category: &str, _key: &str, _value: &str) {}
}

/// Log a fatal boot error and exit. Boot failures have no supervisor to hand a
/// `Result` back to — the RUST RULES permit the abort only here, in `main`.
fn fatal(context: &str, err: &dyn std::fmt::Display) -> ! {
    tracing::error!(error = %err, "{context}");
    flush_and_exit(1);
}

/// Give the non-blocking log writer a beat to flush before exiting. `process::exit`
/// skips the `WorkerGuard` drop, so without this the fatal line can be dropped —
/// the silent death that hid the stale-daemon EADDRINUSE crash (index.ts
/// `main().catch` waits 200ms before `process.exit(1)`).
fn flush_and_exit(code: i32) -> ! {
    std::thread::sleep(std::time::Duration::from_millis(200));
    std::process::exit(code);
}

async fn shutdown_signal() {
    let ctrl_c = async {
        // Boot-time signal handler installation failure is unrecoverable — the
        // process has no path forward without it — so this is treated as a
        // fatal boot condition per the RUST RULES exemption for main.rs boot.
        #[allow(clippy::expect_used)]
        signal::ctrl_c()
            .await
            .expect("failed to install SIGINT handler");
    };

    #[cfg(unix)]
    let terminate = async {
        #[allow(clippy::expect_used)]
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
    info!("shutdown signal received, draining in-flight requests");
}

// PORT STATUS: src/index.ts (full boot: adapters/background-tasks/reconcile/
// liveness + ChatManager + launch/tunnel/plugins/lsp wired; clusters B+F child-
// registry sweep + background_task.updated wired; workflows deliberately
// unported per SCOPE DECISION 2026-07-10)
// confidence: medium
// todos: 2
// notes: ResolvedPath::resolve() probes the login shell (execFileSync exception)
// once at boot; the value is threaded EXPLICITLY (set_var is unsafe under edition
// 2024 + forbid(unsafe_code)) into every child spawn — adapters (claude/codex
// sessions + probe + version), title generation, LSP external-server detection +
// spawn, launch children (composed with the MAINFRAME_ORIG_PATH clean-env
// contract), background-task lsof/kill probes, and resolve-executable `which`
// detection — plus AppCtx for on-demand route resolution. AdapterRegistry registers
// claude+codex, seeds static snapshots, configures refresh (resolveExecutablePath
// reads the provider path off the DB actor + `which` fallback; backfill's setting
// WRITE bridge is unwired), allows + fires refreshAll. BackgroundTaskTracker
// events bridge to the broadcast; reconcile runs over a pre-fetched read snapshot
// (ReconcileDb is sync, actor is async — snapshot avoids a sync-DB bridge);
// backfillWorktreeRelationships runs post-listen as an actor read→git-compute→
// actor-write bridge (compute_worktree_parent_links is DB-free so the async git
// enumeration stays outside the actor closure); liveness scheduler started +
// stopped on shutdown. chat_manager wired via build_chat_manager (Task 4.6c) with a
// RegistryLaunchStopper over the real LaunchRegistry. Task 5.5 wired: TunnelManager
// + LaunchRegistry (BroadcastFn over the channel), LspRegistry/LspManager,
// PluginManager (DaemonPluginHostDb over the Db actor; claude/codex/todos builtins
// via builtin_plugins::load_builtin_plugins — adapters stay on the AdapterRegistry,
// their plugin activate is a no-op for the GET /api/plugins listing). index.ts's
// pluginManager.loadAll() (on-disk user-plugin discovery under data_dir/plugins) is
// a DELIBERATE v1 omission per §2.9/§5 — the PluginManager is builtin-only and has
// no load_all; user-installed plugins are not loaded (disclosed at the boot step).
// LspRegistry::with_bundled is wired from MAINFRAME_BUNDLED_NODE +
// MAINFRAME_BUNDLED_LSP_ROOT (the packaging layer's node sidecar + node_modules
// root; TS used require.resolve + process.execPath). Unset in dev → bundled
// TS/Python resolve to None, only external jdtls spawns. Daemon tunnel
// auto-start (opt-in) sets the /health URL. CLI: --version/version answered before
// logging init; pair/status are loopback HTTP clients (cli module); update is not
// ported. Shutdown order matches index.ts: chats.dispose → plugins.unload_all →
// adapters.kill_all → launch.stop_all → tunnel.stop_all → liveness.stop →
// lsp.shutdown_all (server.stop) → db drop; workflows.stop() deliberately skipped.
// Clusters B/F: tunnel + launch share one FileChildRegistry(managed-children.json);
// cloudflared is resolved to an absolute path at boot (resolve_cloudflared_path
// over the login-shell PATH) and passed via TunnelManagerOptions; sweep_stray_
// children runs AFTER the port bind (the single-instance guard) and before the
// daemon tunnel spawn; the tracker's Updated event bridges to
// background_task.updated. A panic hook (uncaughtException twin) kills adapter +
// tunnel children before the default hook; async launch stop_all is not awaitable
// from a sync hook, so leaked launch children are reaped by the next boot's sweep.
// flush_and_exit sleeps 200ms before every fatal std::process::exit so the non-
// blocking log writer (WorkerGuard, skipped by process::exit) flushes the line.
