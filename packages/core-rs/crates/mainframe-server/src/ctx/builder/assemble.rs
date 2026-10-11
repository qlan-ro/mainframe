use super::*;
use crate::{
    RegistryLaunchStopper, RegistryScopeTunnelStopper, build_chat_manager, build_orchestration,
};
use mainframe_services::quota::{QuotaManager, QuotaManagerDeps};

impl AppCtxBuilder {
    pub(super) fn assemble(self) -> AppCtx {
        let db = self.db;
        let data_dir = self.data_dir;
        let broadcast = self.broadcast.unwrap_or_else(|| broadcast::channel(1024).0);
        let resolved_path = self
            .resolved_path
            .unwrap_or_else(|| ResolvedPath::from_value("/usr/bin:/bin"));
        let git = self.git.unwrap_or_default();
        let adapter_registry = self
            .adapter_registry
            .unwrap_or_else(|| Arc::new(AdapterRegistry::new()));
        let background_tasks = self
            .background_tasks
            .unwrap_or_else(|| Arc::new(BackgroundTaskTracker::new()));
        let claude_workflows = self
            .claude_workflows
            .unwrap_or_else(|| Arc::new(ClaudeWorkflowStore::new()));
        let services = self.services.unwrap_or_else(|| {
            let tx = broadcast.clone();
            Services {
                attachments: Arc::new(AttachmentStore::new(data_dir.join("attachments"))),
                push: Arc::new(PushService::new()),
                watcher: Arc::new(FileWatcherService::new(move |event| {
                    let _ = tx.send(event);
                })),
            }
        });
        let on_event: mainframe_launch::BroadcastFn = {
            let tx = broadcast.clone();
            Arc::new(move |event| {
                let _ = tx.send(event);
            })
        };
        let tunnel_manager = self
            .tunnel_manager
            .unwrap_or_else(|| Arc::new(TunnelManager::new(Some(on_event.clone()))));
        let port_tunnels = self
            .port_tunnels
            .unwrap_or_else(|| Arc::new(PortTunnelRegistry::new(tunnel_manager.clone())));
        let launch_registry = self.launch_registry.unwrap_or_else(|| {
            Arc::new(LaunchRegistry::new(
                on_event.clone(),
                Some(tunnel_manager.clone()),
            ))
        });
        let quota_manager = Arc::new(QuotaManager::new(QuotaManagerDeps {
            settings: Arc::new(db.clone()),
            emit_event: Box::new(move |event| on_event(event)),
            now: None,
        }));
        let quota = self.quota.unwrap_or_else(|| quota_manager.clone());
        let facade_hub = self
            .facade_hub
            .unwrap_or_else(|| Arc::new(FacadeHub::default()));
        let chat_manager = self.chat_manager.unwrap_or_else(|| {
            build_chat_manager(
                db.clone(),
                adapter_registry.clone(),
                background_tasks.clone(),
                services.attachments.clone(),
                services.push.clone(),
                git,
                broadcast.clone(),
                Arc::new(RegistryLaunchStopper::new(launch_registry.clone())),
                Arc::new(RegistryScopeTunnelStopper::new(
                    port_tunnels.clone(),
                    db.clone(),
                )),
                quota_manager,
                claude_workflows.clone(),
                resolved_path.clone(),
                Some(facade_hub.as_chat_surface()),
                data_dir.clone(),
            )
        });
        let version = self.version.unwrap_or_else(|| "0.0.0-test".into());
        let port = self.port.unwrap_or(0);
        let orchestration = self.orchestration.unwrap_or_else(|| {
            build_orchestration(
                chat_manager.clone(),
                db.clone(),
                adapter_registry.clone(),
                broadcast.clone(),
                &version,
                port,
            )
        });
        let plugin_manager = self.plugin_manager.unwrap_or_else(|| {
            let tx = broadcast.clone();
            Arc::new(PluginManager::new(
                mainframe_plugins::manager::PluginManagerDeps {
                    host_db: Arc::new(crate::wiring::plugin_host_db::DaemonPluginHostDb::new(
                        db.clone(),
                    )),
                    emit: Arc::new(move |event| {
                        let _ = tx.send(event);
                    }),
                    github: None,
                },
            ))
        });
        AppCtx {
            core: CoreCtx {
                db,
                git,
                broadcast,
                adapter_registry,
                background_tasks,
                claude_workflows,
                data_dir,
                version,
                port,
                auth_secret: self.auth_secret.flatten(),
                resolved_path,
            },
            chat: ChatCtx {
                chat_manager,
                facade_hub,
                orchestration,
                facade_heartbeat_interval_ms: self
                    .facade_heartbeat_interval_ms
                    .unwrap_or(mainframe_acp::DEFAULT_HEARTBEAT_INTERVAL_MS),
            },
            infra: InfraCtx {
                tunnel_manager,
                port_tunnels,
                launch_registry,
                plugin_manager,
                lsp_manager: self.lsp_manager.unwrap_or_else(|| {
                    Arc::new(LspManager::new(Arc::new(mainframe_lsp::LspRegistry::new())))
                }),
                ws_clients: self
                    .ws_clients
                    .unwrap_or_else(|| Arc::new(dashmap::DashMap::new())),
                tunnel_url: self
                    .tunnel_url
                    .unwrap_or_else(|| Arc::new(RwLock::new(None))),
            },
            services: ServicesCtx {
                attachments: services.attachments,
                push: services.push,
                watcher: services.watcher,
                quota,
                automations: self.automations.flatten(),
            },
        }
    }
}
