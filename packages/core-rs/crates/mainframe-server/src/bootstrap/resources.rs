use super::*;

pub(super) struct Resources {
    pub(super) broadcast: broadcast::Sender<DaemonEvent>,
    pub(super) _keepalive_rx: broadcast::Receiver<DaemonEvent>,
    pub(super) child_registry: Arc<dyn ChildRegistryPort>,
    pub(super) tunnel_manager: Arc<TunnelManager>,
    pub(super) port_tunnels: Arc<PortTunnelRegistry>,
    pub(super) launch_registry: Arc<LaunchRegistry>,
    pub(super) background_tasks: Arc<BackgroundTaskTracker>,
    pub(super) claude_workflows: Arc<ClaudeWorkflowStore>,
    pub(super) adapters: Arc<AdapterRegistry>,
    pub(super) services: Services,
}
impl Resources {
    pub(super) async fn new(bound: &BoundBootstrap) -> Self {
        let data_dir = &bound.input.paths.data_dir;
        let resolved_path = &bound.input.resolved_path;
        let (broadcast, _keepalive_rx) = tokio::sync::broadcast::channel::<DaemonEvent>(1024);

        let watcher_tx = broadcast.clone();
        let watcher = FileWatcherService::new(move |event| {
            let _ = watcher_tx.send(event);
        });

        let event_bcast = broadcast.clone();
        let on_event: BroadcastFn = Arc::new(move |event| {
            let _ = event_bcast.send(event);
        });

        let child_registry: Arc<dyn ChildRegistryPort> = Arc::new(FileChildRegistry::new(
            data_dir
                .join("managed-children.json")
                .to_string_lossy()
                .into_owned(),
        ));

        let (tunnel_manager, port_tunnels, launch_registry) =
            launch_handles(bound, &on_event, &child_registry).await;
        let background_tasks =
            Arc::new(BackgroundTaskTracker::new().with_resolved_path(resolved_path.clone()));
        let claude_workflows = Arc::new(ClaudeWorkflowStore::new());
        let adapters = adapters(
            bound,
            &background_tasks,
            &claude_workflows,
            &tunnel_manager,
            &broadcast,
        );
        let services = Services {
            attachments: Arc::new(AttachmentStore::new(data_dir.join("attachments"))),
            push: Arc::new(PushService::new()),
            watcher: Arc::new(watcher),
        };

        Self {
            broadcast,
            _keepalive_rx,
            child_registry,
            tunnel_manager,
            port_tunnels,
            launch_registry,
            background_tasks,
            claude_workflows,
            adapters,
            services,
        }
    }
}

async fn launch_handles(
    bound: &BoundBootstrap,
    on_event: &BroadcastFn,
    child_registry: &Arc<dyn ChildRegistryPort>,
) -> (
    Arc<TunnelManager>,
    Arc<PortTunnelRegistry>,
    Arc<LaunchRegistry>,
) {
    let resolved_path = &bound.input.resolved_path;
    let cloudflared_path = resolve_cloudflared_path(ResolveCloudflaredDeps {
        path: Some(resolved_path.as_str().to_string()),
        ..Default::default()
    })
    .await;

    let tunnel_manager = Arc::new(
        TunnelManager::with_options(
            Some(Arc::clone(on_event)),
            TunnelManagerOptions {
                registry: Some(Arc::clone(child_registry)),
                cloudflared_path,
            },
        )
        .with_resolved_path(resolved_path.as_str()),
    );
    let port_tunnels = Arc::new(PortTunnelRegistry::new(Arc::clone(&tunnel_manager)));
    let launch_registry = Arc::new(
        LaunchRegistry::new(Arc::clone(on_event), Some(Arc::clone(&tunnel_manager)))
            .with_child_registry(Arc::clone(child_registry))
            .with_resolved_path(resolved_path.as_str()),
    );

    (tunnel_manager, port_tunnels, launch_registry)
}

fn adapters(
    bound: &BoundBootstrap,
    background_tasks: &Arc<BackgroundTaskTracker>,
    claude_workflows: &Arc<ClaudeWorkflowStore>,
    tunnel_manager: &Arc<TunnelManager>,
    broadcast: &broadcast::Sender<DaemonEvent>,
) -> Arc<AdapterRegistry> {
    let resolved_path = &bound.input.resolved_path;
    let db = &bound.db;
    let adapters = Arc::new(AdapterRegistry::new());
    adapters.register(Arc::new(ClaudeAdapter::new(
        Arc::clone(background_tasks),
        Arc::clone(claude_workflows),
        resolved_path.clone(),
    )));
    adapters.register(Arc::new(CodexAdapter::new(
        Arc::clone(background_tasks),
        resolved_path.clone(),
    )));
    if std::env::var("E2E_MODE").as_deref() == Ok("mock") {
        tracing::warn!("E2E mock mode enabled; registering the native replay adapters");
        for mock in e2e_mock::mock_adapters(background_tasks, claude_workflows, |name| {
            std::env::var(name).ok()
        }) {
            adapters.register(Arc::new(mock));
        }
    }
    adapters.seed_static_snapshots();

    spawn_task_event_bridge(Arc::clone(background_tasks), broadcast.clone());
    spawn_workflow_run_bridge(Arc::clone(claude_workflows), broadcast.clone());

    // Kill adapters and cloudflared before the default panic hook to avoid orphaning them.
    install_panic_cleanup(&adapters, tunnel_manager);
    // Configure before serve so no request can trigger an unconfigured probe.
    adapters.configure_refresh(Arc::new(DaemonRefreshDeps {
        db: db.clone(),
        broadcast: broadcast.clone(),
        resolved_path: resolved_path.clone(),
    }));

    adapters
}

fn install_panic_cleanup(adapters: &Arc<AdapterRegistry>, tunnel_manager: &Arc<TunnelManager>) {
    {
        let panic_adapters = Arc::clone(adapters);
        let panic_tunnel = Arc::clone(tunnel_manager);
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            tracing::error!(panic = %info, "Uncaught exception");
            // Launch teardown needs async I/O; the next boot sweep handles those children.
            panic_adapters.kill_all();
            panic_tunnel.signal_all_on_panic();
            default_hook(info);
        }));
    }
}
