//! Ported from `src/index.ts`, `src/cli/*` (packages/core).
//!
//! Phase-4 boot: enrichPath → config → auth secret → DB (actor handle) →
//! BackgroundTaskTracker → AdapterRegistry (claude+codex, static seed, refresh) →
//! services → broadcast → HTTP/WS server, then background-task reconcile + the
//! liveness scheduler + the adapter catalog refresh, with graceful
//! SIGINT/SIGTERM shutdown (adapters.killAll + liveness.stop). The ChatManager,
//! plugins, launch, tunnel, and workflows boot steps stay TODO(port) — the
//! ChatManager needs a `ChatManagerDeps` impl blocked on a sync-DB bridge (see
//! the notes trailer); plugins/launch/tunnel/workflows are unported crates.
#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

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
use mainframe_server::ctx::{AppCtx, DefaultRunner, GitFactory, Services};
use mainframe_server::db::Db;
use mainframe_server::{build_app, spawn_broadcast_pump};
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

/// Resolve the login-shell `PATH` so spawned CLIs (claude/codex) match a user's
/// interactive shell. Mirrors `enrichPath()`; `execFileSync` at boot is the
/// sanctioned exception. TODO(port): the TS mutates `process.env.PATH`; under
/// edition 2024 `std::env::set_var` is `unsafe` and this crate is
/// `#![forbid(unsafe_code)]`, and the ported adapter spawns inherit the daemon
/// env without a PATH-threading hook — so the resolved value is logged but not
/// applied. Applying it needs an env-threading contract into the adapter spawn
/// layer (blocker).
fn enrich_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    match Command::new(&shell)
        .args(["-lic", "echo \"$PATH\""])
        .output()
    {
        Ok(out) => {
            let resolved = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !resolved.is_empty() {
                tracing::debug!(
                    shell,
                    path_length = resolved.split(':').count(),
                    "enrichPath: resolved from login shell"
                );
                return;
            }
        }
        Err(err) => {
            tracing::warn!(%err, "enrichPath: login shell failed, using fallback");
        }
    }
    let current =
        std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".to_string());
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extra = [
        format!("{home}/.local/bin"),
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
    ];
    let seen: std::collections::HashSet<&str> = current.split(':').collect();
    let additions: Vec<&String> = extra
        .iter()
        .filter(|p| !seen.contains(p.as_str()))
        .collect();
    tracing::debug!(?additions, "enrichPath: fallback applied");
}

#[tokio::main]
async fn main() {
    let _log_guard = mainframe_runtime::logging::init();

    enrich_path();

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

    // Registries + adapters. ClaudeAdapter needs the tracker (background-task
    // ownership); both adapters register before the static snapshot seed so
    // `GET /api/adapters` serves instantly without a CLI spawn.
    let background_tasks = Arc::new(BackgroundTaskTracker::new());
    let adapters = Arc::new(AdapterRegistry::new());
    adapters.register(Arc::new(ClaudeAdapter::new(Arc::clone(&background_tasks))));
    adapters.register(Arc::new(CodexAdapter::new()));
    adapters.seed_static_snapshots();

    // Forward tracker emissions through the broadcast (index.ts wires
    // background_task.started/ended onto broadcastEvent).
    spawn_task_event_bridge(Arc::clone(&background_tasks), broadcast.clone());

    // Configure the refresh BEFORE server start so no request triggers an
    // unconfigured probe. resolveExecutablePath reads the persisted provider path
    // via the DB actor, then falls back to `which` detection through the shared
    // resolver. TODO(port): backfillAdapterExecutables (persisting detected paths)
    // needs a sync `SettingsWriter` write bridge to the async DB actor — not wired,
    // so refresh re-detects each run instead of reading a backfilled path.
    adapters.configure_refresh(Arc::new(DaemonRefreshDeps {
        db: db.clone(),
        broadcast: broadcast.clone(),
    }));

    let services = Services {
        attachments: Arc::new(AttachmentStore::new(data_dir.join("attachments"))),
        push: Arc::new(PushService::new()),
        watcher: Arc::new(watcher),
    };

    let ctx = Arc::new(AppCtx {
        db: db.clone(),
        git: GitFactory,
        services,
        broadcast: broadcast.clone(),
        data_dir,
        version: DAEMON_VERSION.to_string(),
        auth_secret,
        tunnel_url: None,
        ws_clients: Arc::new(dashmap::DashMap::new()),
        adapter_registry: Arc::clone(&adapters),
        background_tasks: Arc::clone(&background_tasks),
        // TODO(port): ChatManager construction needs a `ChatManagerDeps` impl. Its
        // DB accessors are synchronous over a `!Send` `DatabaseManager` (only the
        // async `Db` actor is available — no sanctioned sync bridge), and several
        // methods (stop_launch_processes, update_todos, notifications) depend on
        // unported crates (launch, plugins/todos). Left `None`; the chat routes +
        // WS message.send/permission.respond seams gracefully degrade until wired.
        chat_manager: None,
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

    // Post-listen boot (index.ts runs these after server.start()): the liveness
    // sweep scheduler, a non-blocking background-task reconcile, and the adapter
    // catalog refresh. All are fire-and-forget with the same warn-on-failure.
    let liveness = start_liveness_scheduler(LivenessDeps {
        tracker: Arc::clone(&background_tasks),
        interval_ms: None,
    });
    spawn_reconcile(db.clone(), Arc::clone(&background_tasks));

    // allowRefresh() gates a pre-configure probe; refreshAll enriches
    // installed/version/models per adapter and emits. Non-blocking.
    adapters.allow_refresh();
    let refresh_adapters = Arc::clone(&adapters);
    tokio::spawn(async move {
        refresh_adapters.refresh_all().await;
    });

    info!("Daemon ready");

    let service = app.into_make_service_with_connect_info::<SocketAddr>();
    if let Err(err) = axum::serve(listener, service)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        tracing::error!(%err, "daemon server exited with error");
        std::process::exit(1);
    }

    // Ordered shutdown (index.ts `shutdown`): the unported steps (workflows.stop,
    // chats.dispose, pluginManager.unloadAll, launchRegistry.stopAll,
    // tunnelManager.stopAll) are skipped; adapters.killAll + liveness.stop run.
    info!("Shutting down...");
    adapters.kill_all();
    liveness.stop();
    // `db` (the actor thread) closes when the last `Db` handle drops at exit.
}

/// Drain the tracker's `TaskEvent` broadcast and re-emit as daemon
/// `background_task.started`/`ended` events. Mirrors the two `backgroundTasks.on`
/// forwarders in index.ts.
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
}

impl RefreshDeps for DaemonRefreshDeps {
    fn resolve_executable_path(&self, adapter_id: String) -> BoxFuture<'_, Option<String>> {
        let db = self.db.clone();
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
                    run: &DefaultRunner,
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
        Box::pin(async move {
            mainframe_adapter_api::resolve_executable::default_run(&cmd, &args, timeout_ms).await
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
    std::process::exit(1);
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

// PORT STATUS: src/index.ts (Phase-4 boot: adapters/background-tasks/reconcile/
// liveness wired; ChatManager/plugins/launch/tunnel/workflows deferred)
// confidence: medium
// todos: 3
// notes: enrichPath probes the login shell (execFileSync exception) but cannot
// apply PATH (set_var is unsafe under edition 2024 + forbid(unsafe_code); no
// adapter-spawn PATH-threading hook) — logged only. AdapterRegistry registers
// claude+codex, seeds static snapshots, configures refresh (resolveExecutablePath
// reads the provider path off the DB actor + `which` fallback; backfill's setting
// WRITE bridge is unwired), allows + fires refreshAll. BackgroundTaskTracker
// events bridge to the broadcast; reconcile runs over a pre-fetched read snapshot
// (ReconcileDb is sync, actor is async — snapshot avoids a sync-DB bridge);
// liveness scheduler started + stopped on shutdown. chat_manager stays None: a
// production ChatManagerDeps needs a sync-DB bridge (its DB accessors are sync
// over the !Send DatabaseManager) + unported crates (launch/plugins-todos/
// notifications) — a blocker. Shutdown runs adapters.killAll + liveness.stop; the
// unported dispose/unload/stopAll steps are skipped.
