use super::*;
use mainframe_automations::AutomationsEngine;
use mainframe_chat::chat_manager::ChatManager;
use resources::Resources;

pub(super) async fn assemble(
    bound: BoundBootstrap,
    resources: Resources,
) -> Result<Daemon, BootError> {
    let quota = quota(&bound, &resources).await;
    let facade = Arc::new(crate::FacadeHub::default());
    let chats = chats(&bound, &resources, &quota, &facade);
    chats.recover_stale_working_state();
    chats.sweep_unreferenced_fork_snapshots().await;
    let orchestration = build_orchestration(
        chats.clone(),
        bound.db.clone(),
        resources.adapters.clone(),
        resources.broadcast.clone(),
        &bound.input.version,
        bound.input.config.port,
    );
    let orchestration_events = orchestration.spawn_event_loop();
    let automations = automations(&bound, &resources, &chats).await;
    let plugins = plugins(&bound, &resources, &automations).await;
    let builder = context_builder(&bound, &resources)
        .facade_hub(facade)
        .chat_manager(chats)
        .orchestration(orchestration)
        .automations(automations)
        .plugin_manager(plugins)
        .quota(quota.clone());
    let ctx = Arc::new(builder.build()?);
    Ok(Daemon {
        ctx,
        listener: bound.listener,
        config: bound.input.config,
        handles: DaemonHandles {
            child_registry: resources.child_registry,
            quota_manager: quota,
            orchestration_events,
            keepalive: resources._keepalive_rx,
        },
    })
}

async fn quota(bound: &BoundBootstrap, resources: &Resources) -> Arc<QuotaManager> {
    let emit = resources.broadcast.clone();
    let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings: Arc::new(bound.db.clone()),
        now: None,
        emit_event: Box::new(move |event| {
            let _ = emit.send(event);
        }),
    }));
    initialize_quota(
        &quota,
        &resources.adapters,
        &bound.db,
        &bound.input.resolved_path,
    )
    .await;
    quota
}

fn chats(
    bound: &BoundBootstrap,
    r: &Resources,
    quota: &Arc<QuotaManager>,
    facade: &Arc<crate::FacadeHub>,
) -> Arc<ChatManager> {
    build_chat_manager(crate::ChatManagerParams {
        db: bound.db.clone(),
        adapters: r.adapters.clone(),
        background_tasks: r.background_tasks.clone(),
        attachments: r.services.attachments.clone(),
        push: r.services.push.clone(),
        git: GitFactory,
        broadcast: r.broadcast.clone(),
        launch: Arc::new(RegistryLaunchStopper::new(r.launch_registry.clone())),
        scope_tunnels: Arc::new(RegistryScopeTunnelStopper::new(
            r.port_tunnels.clone(),
            bound.db.clone(),
        )),
        quota: quota.clone(),
        claude_workflows: r.claude_workflows.clone(),
        chat_surface: Some(facade.as_chat_surface()),
        data_dir: bound.input.paths.data_dir.clone(),
    })
}

async fn automations(
    bound: &BoundBootstrap,
    r: &Resources,
    chats: &Arc<ChatManager>,
) -> Option<Arc<AutomationsEngine>> {
    let engine = build_automations_engine(
        bound.db.clone(),
        chats.clone(),
        r.broadcast.clone(),
        r.services.push.clone(),
        GitFactory,
        &bound.input.paths.data_dir,
    )
    .await;
    if let Some(engine) = &engine
        && let Err(err) = engine.start().await
    {
        tracing::error!(%err, "failed to start the automations engine");
    }
    engine
}

async fn plugins(
    bound: &BoundBootstrap,
    r: &Resources,
    automations: &Option<Arc<AutomationsEngine>>,
) -> Arc<PluginManager> {
    let broadcast = r.broadcast.clone();
    let emit: EmitSink = Arc::new(move |event| {
        let _ = broadcast.send(event);
    });
    let github: Option<Arc<dyn GitHubIssues>> = automations.as_ref().and_then(|engine| {
        match github_issues_port::DaemonGitHubIssuesPort::new(engine.credentials()) {
            Ok(port) => Some(Arc::new(port) as Arc<dyn GitHubIssues>),
            Err(err) => {
                tracing::error!(%err, "github issues port unavailable: HTTP client build failed");
                None
            }
        }
    });
    let manager = Arc::new(PluginManager::new(PluginManagerDeps {
        host_db: Arc::new(DaemonPluginHostDb::new(bound.db.clone())),
        emit,
        github,
    }));
    if let Err(err) =
        builtin_plugins::load_builtin_plugins(&manager, &bound.input.paths.data_dir).await
    {
        tracing::error!(%err, "failed to load builtin plugins");
    }
    manager
}

fn context_builder(bound: &BoundBootstrap, r: &Resources) -> crate::ctx::AppCtxBuilder {
    let input = &bound.input;
    let lsp = LspRegistry::new().with_resolved_path(input.resolved_path.as_str());
    AppCtx::builder(bound.db.clone(), input.paths.data_dir.clone())
        .git(GitFactory)
        .services(r.services.clone())
        .broadcast(r.broadcast.clone())
        .version(input.version.clone())
        .port(input.config.port)
        .auth_secret(input.auth_secret.clone())
        .resolved_path(input.resolved_path.clone())
        .tunnel_url(Arc::new(RwLock::new(None)))
        .ws_clients(Arc::new(dashmap::DashMap::new()))
        .facade_heartbeat_interval_ms(mainframe_acp::DEFAULT_HEARTBEAT_INTERVAL_MS)
        .adapter_registry(r.adapters.clone())
        .background_tasks(r.background_tasks.clone())
        .claude_workflows(r.claude_workflows.clone())
        .launch_registry(r.launch_registry.clone())
        .tunnel_manager(r.tunnel_manager.clone())
        .port_tunnels(r.port_tunnels.clone())
        .lsp_manager(Arc::new(LspManager::new(Arc::new(lsp))))
}

async fn initialize_quota(
    quota: &Arc<QuotaManager>,
    adapters: &AdapterRegistry,
    db: &Db,
    path: &mainframe_runtime::ResolvedPath,
) {
    register_quota_sources(quota, adapters, db, path);
    quota.load_from_disk().await;
}

#[cfg(test)]
#[path = "quota_tests.rs"]
mod quota_tests;
