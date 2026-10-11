use super::*;
use crate::{
    RegistryLaunchStopper, RegistryScopeTunnelStopper, build_chat_manager, build_orchestration,
};
use mainframe_services::quota::{QuotaManager, QuotaManagerDeps};

impl AppCtxBuilder {
    pub(super) fn assemble(mut self) -> AppCtx {
        let core = self.core_defaults();
        let infra = self.infra_defaults(&core);
        let (services, quota) = self.service_defaults(&core);
        let chat = self.chat_defaults(&core, &infra, &services, quota);
        AppCtx {
            core,
            infra,
            services,
            chat,
        }
    }

    fn core_defaults(&mut self) -> CoreCtx {
        CoreCtx {
            db: self.db.clone(),
            data_dir: self.data_dir.clone(),
            broadcast: self
                .broadcast
                .take()
                .unwrap_or_else(|| broadcast::channel(1024).0),
            resolved_path: self
                .resolved_path
                .take()
                .unwrap_or_else(|| ResolvedPath::from_value("/usr/bin:/bin")),
            git: self.git.take().unwrap_or_default(),
            adapter_registry: self
                .adapter_registry
                .take()
                .unwrap_or_else(|| Arc::new(AdapterRegistry::new())),
            background_tasks: self
                .background_tasks
                .take()
                .unwrap_or_else(|| Arc::new(BackgroundTaskTracker::new())),
            claude_workflows: self
                .claude_workflows
                .take()
                .unwrap_or_else(|| Arc::new(ClaudeWorkflowStore::new())),
            version: self.version.take().unwrap_or_else(|| "0.0.0-test".into()),
            port: self.port.unwrap_or(0),
            auth_secret: self.auth_secret.take().flatten(),
        }
    }

    fn service_defaults(&mut self, core: &CoreCtx) -> (ServicesCtx, Arc<QuotaManager>) {
        let services = self.services.take().unwrap_or_else(|| {
            let tx = core.broadcast.clone();
            Services {
                attachments: Arc::new(AttachmentStore::new(core.data_dir.join("attachments"))),
                push: Arc::new(PushService::new()),
                watcher: Arc::new(FileWatcherService::new(move |event| {
                    let _ = tx.send(event);
                })),
            }
        });
        let tx = core.broadcast.clone();
        let manager = Arc::new(QuotaManager::new(QuotaManagerDeps {
            settings: Arc::new(core.db.clone()),
            now: None,
            emit_event: Box::new(move |event| {
                let _ = tx.send(event);
            }),
        }));
        (
            ServicesCtx {
                attachments: services.attachments,
                push: services.push,
                watcher: services.watcher,
                quota: self.quota.take().unwrap_or_else(|| manager.clone()),
                automations: self.automations.take().flatten(),
            },
            manager,
        )
    }

    fn infra_defaults(&mut self, core: &CoreCtx) -> InfraCtx {
        let tx = core.broadcast.clone();
        let on_event: mainframe_launch::BroadcastFn = Arc::new(move |event| {
            let _ = tx.send(event);
        });
        let tunnel_manager = self
            .tunnel_manager
            .take()
            .unwrap_or_else(|| Arc::new(TunnelManager::new(Some(on_event.clone()))));
        let port_tunnels = self
            .port_tunnels
            .take()
            .unwrap_or_else(|| Arc::new(PortTunnelRegistry::new(tunnel_manager.clone())));
        let launch_registry = self.launch_registry.take().unwrap_or_else(|| {
            Arc::new(LaunchRegistry::new(on_event, Some(tunnel_manager.clone())))
        });
        let plugin_manager = self.plugin_manager.take().unwrap_or_else(|| {
            let tx = core.broadcast.clone();
            Arc::new(PluginManager::new(
                mainframe_plugins::manager::PluginManagerDeps {
                    host_db: Arc::new(crate::wiring::plugin_host_db::DaemonPluginHostDb::new(
                        core.db.clone(),
                    )),
                    emit: Arc::new(move |event| {
                        let _ = tx.send(event);
                    }),
                    github: None,
                },
            ))
        });
        InfraCtx {
            tunnel_manager,
            port_tunnels,
            launch_registry,
            plugin_manager,
            lsp_manager: self.lsp_manager.take().unwrap_or_else(|| {
                Arc::new(LspManager::new(Arc::new(mainframe_lsp::LspRegistry::new())))
            }),
            ws_clients: self
                .ws_clients
                .take()
                .unwrap_or_else(|| Arc::new(dashmap::DashMap::new())),
            tunnel_url: self
                .tunnel_url
                .take()
                .unwrap_or_else(|| Arc::new(RwLock::new(None))),
        }
    }

    fn chat_defaults(
        &mut self,
        core: &CoreCtx,
        infra: &InfraCtx,
        services: &ServicesCtx,
        quota: Arc<QuotaManager>,
    ) -> ChatCtx {
        let facade_hub = self
            .facade_hub
            .take()
            .unwrap_or_else(|| Arc::new(FacadeHub::default()));
        let chat_manager = self.chat_manager.take().unwrap_or_else(|| {
            build_chat_manager(
                core.db.clone(),
                core.adapter_registry.clone(),
                core.background_tasks.clone(),
                services.attachments.clone(),
                services.push.clone(),
                core.git,
                core.broadcast.clone(),
                Arc::new(RegistryLaunchStopper::new(infra.launch_registry.clone())),
                Arc::new(RegistryScopeTunnelStopper::new(
                    infra.port_tunnels.clone(),
                    core.db.clone(),
                )),
                quota,
                core.claude_workflows.clone(),
                core.resolved_path.clone(),
                Some(facade_hub.as_chat_surface()),
                core.data_dir.clone(),
            )
        });
        let orchestration = self.orchestration.take().unwrap_or_else(|| {
            build_orchestration(
                chat_manager.clone(),
                core.db.clone(),
                core.adapter_registry.clone(),
                core.broadcast.clone(),
                &core.version,
                core.port,
            )
        });
        ChatCtx {
            chat_manager,
            facade_hub,
            orchestration,
            facade_heartbeat_interval_ms: self
                .facade_heartbeat_interval_ms
                .unwrap_or(mainframe_acp::DEFAULT_HEARTBEAT_INTERVAL_MS),
        }
    }
}
