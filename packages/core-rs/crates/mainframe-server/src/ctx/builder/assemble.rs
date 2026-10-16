use super::*;

#[derive(Debug, thiserror::Error)]
#[error("missing application context dependency: {0}")]
pub struct BuildError(&'static str);

impl AppCtxBuilder {
    pub(super) fn assemble(self) -> Result<AppCtx, BuildError> {
        #[cfg(any(test, feature = "test-support"))]
        if self.test_defaults {
            return Ok(self.assemble_test());
        }
        macro_rules! required {
            ($field:ident) => {
                self.$field.ok_or(BuildError(stringify!($field)))?
            };
        }
        let services = required!(services);
        let core = CoreCtx {
            db: self.db,
            data_dir: self.data_dir,
            git: required!(git),
            broadcast: required!(broadcast),
            resolved_path: required!(resolved_path),
            adapter_registry: required!(adapter_registry),
            background_tasks: required!(background_tasks),
            claude_workflows: required!(claude_workflows),
            version: required!(version),
            port: required!(port),
            auth_secret: required!(auth_secret),
        };
        let cli_updates = crate::cli_update::CliUpdateManager::for_daemon(&core);
        Ok(AppCtx {
            core,
            infra: InfraCtx {
                tunnel_manager: required!(tunnel_manager),
                port_tunnels: required!(port_tunnels),
                launch_registry: required!(launch_registry),
                plugin_manager: required!(plugin_manager),
                lsp_manager: required!(lsp_manager),
                ws_clients: required!(ws_clients),
                tunnel_url: required!(tunnel_url),
            },
            services: ServicesCtx {
                attachments: services.attachments,
                push: services.push,
                watcher: services.watcher,
                quota: required!(quota),
                cli_updates,
                automations: required!(automations),
            },
            chat: ChatCtx {
                chat_manager: required!(chat_manager),
                facade_hub: required!(facade_hub),
                orchestration: required!(orchestration),
                facade_heartbeat_interval_ms: required!(facade_heartbeat_interval_ms),
            },
        })
    }
}
