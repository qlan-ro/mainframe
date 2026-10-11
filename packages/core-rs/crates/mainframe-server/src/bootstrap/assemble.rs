use super::*;

pub(super) async fn assemble(bound: BoundBootstrap, resources: resources::Resources) -> Daemon {
    let BoundBootstrap {
        input,
        listener,
        db,
    } = bound;
    let Bootstrap {
        config,
        paths,
        resolved_path,
        auth_secret,
        version,
    } = input;
    let data_dir = paths.data_dir;
    let port = config.port;
    let resources::Resources {
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
    } = resources;

    let quota_emit = broadcast.clone();
    let quota_manager = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings: Arc::new(db.clone()),
        emit_event: Box::new(move |event| {
            let _ = quota_emit.send(event);
        }),
        now: None,
    }));
    register_quota_identity_resolvers(&quota_manager);
    quota_manager.load_from_disk().await;
    register_quota_pullers(&quota_manager, &db, &resolved_path);

    let facade_hub = Arc::new(crate::FacadeHub::default());

    let chats = build_chat_manager(
        db.clone(),
        Arc::clone(&adapters),
        Arc::clone(&background_tasks),
        Arc::clone(&services.attachments),
        Arc::clone(&services.push),
        GitFactory,
        broadcast.clone(),
        Arc::new(RegistryLaunchStopper::new(Arc::clone(&launch_registry))),
        Arc::new(RegistryScopeTunnelStopper::new(
            Arc::clone(&port_tunnels),
            db.clone(),
        )),
        Arc::clone(&quota_manager),
        Arc::clone(&claude_workflows),
        resolved_path.clone(),
        Some(facade_hub.as_chat_surface()),
        data_dir.clone(),
    );

    chats.recover_stale_working_state();

    chats.sweep_unreferenced_fork_snapshots().await;

    let orchestration = build_orchestration(
        Arc::clone(&chats),
        db.clone(),
        Arc::clone(&adapters),
        broadcast.clone(),
        version.as_str(),
        port,
    );
    let orchestration_events = orchestration.spawn_event_loop();

    let automations = build_automations_engine(
        db.clone(),
        Arc::clone(&chats),
        broadcast.clone(),
        Arc::clone(&services.push),
        GitFactory,
        &data_dir,
    )
    .await;

    if let Some(automations) = &automations
        && let Err(err) = automations.start().await
    {
        tracing::error!(%err, "failed to start the automations engine");
    }

    let lsp_registry = LspRegistry::new().with_resolved_path(resolved_path.as_str());
    let lsp_manager = Arc::new(LspManager::new(Arc::new(lsp_registry)));

    let plugin_emit_bcast = broadcast.clone();
    let plugin_emit: EmitSink = Arc::new(move |event| {
        let _ = plugin_emit_bcast.send(event);
    });
    let plugin_host_db: Arc<dyn PluginHostDb> = Arc::new(DaemonPluginHostDb::new(db.clone()));

    let github: Option<Arc<dyn GitHubIssues>> = automations.as_ref().and_then(|automations| {
        match github_issues_port::DaemonGitHubIssuesPort::new(automations.credentials()) {
            Ok(port) => Some(Arc::new(port) as Arc<dyn GitHubIssues>),
            Err(err) => {
                tracing::error!(%err, "github issues port unavailable: HTTP client build failed");
                None
            }
        }
    });
    let plugin_manager = Arc::new(PluginManager::new(PluginManagerDeps {
        host_db: plugin_host_db,
        emit: plugin_emit,
        github,
    }));
    if let Err(err) = builtin_plugins::load_builtin_plugins(&plugin_manager, &data_dir).await {
        tracing::error!(%err, "failed to load builtin plugins");
    }

    let ws_clients = Arc::new(dashmap::DashMap::new());

    let ctx = Arc::new(
        AppCtx::builder(db.clone(), data_dir)
            .git(GitFactory)
            .services(services)
            .broadcast(broadcast.clone())
            .version(version.as_str().to_string())
            .port(port)
            .auth_secret(auth_secret)
            .resolved_path(resolved_path.clone())
            .tunnel_url(Arc::new(RwLock::new(None)))
            .ws_clients(Arc::clone(&ws_clients))
            .facade_hub(facade_hub)
            .facade_heartbeat_interval_ms(mainframe_acp::DEFAULT_HEARTBEAT_INTERVAL_MS)
            .adapter_registry(Arc::clone(&adapters))
            .background_tasks(Arc::clone(&background_tasks))
            .claude_workflows(Arc::clone(&claude_workflows))
            .chat_manager(Some(Arc::clone(&chats)))
            .launch_registry(Some(Arc::clone(&launch_registry)))
            .tunnel_manager(Some(Arc::clone(&tunnel_manager)))
            .port_tunnels(Some(Arc::clone(&port_tunnels)))
            .lsp_manager(Some(Arc::clone(&lsp_manager)))
            .plugin_manager(Some(Arc::clone(&plugin_manager)))
            .automations(automations.clone())
            .orchestration(Some(Arc::clone(&orchestration)))
            .quota(Some(quota_manager.clone() as Arc<dyn QuotaService>))
            .build(),
    );

    Daemon {
        ctx,
        listener,
        config,
        handles: DaemonHandles {
            child_registry,
            quota_manager,
            orchestration_events,
            keepalive: _keepalive_rx,
        },
    }
}
