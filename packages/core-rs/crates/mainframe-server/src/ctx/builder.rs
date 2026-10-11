use super::*;

pub struct AppCtxBuilder {
    db: Db,
    data_dir: PathBuf,
    git: Option<GitFactory>,
    services: Option<Services>,
    broadcast: Option<broadcast::Sender<DaemonEvent>>,
    ws_clients: Option<WsClients>,
    facade_hub: Option<Arc<FacadeHub>>,
    facade_heartbeat_interval_ms: Option<u64>,
    adapter_registry: Option<Arc<AdapterRegistry>>,
    background_tasks: Option<Arc<BackgroundTaskTracker>>,
    claude_workflows: Option<Arc<ClaudeWorkflowStore>>,
    chat_manager: Option<Arc<ChatManager>>,
    launch_registry: Option<Arc<LaunchRegistry>>,
    tunnel_manager: Option<Arc<TunnelManager>>,
    port_tunnels: Option<Arc<PortTunnelRegistry>>,
    lsp_manager: Option<Arc<LspManager>>,
    plugin_manager: Option<Arc<PluginManager>>,
    automations: Option<Option<Arc<AutomationsEngine>>>,
    orchestration: Option<Arc<OrchestrationService>>,
    quota: Option<Arc<dyn QuotaService>>,
    version: Option<String>,
    port: Option<u16>,
    auth_secret: Option<Option<String>>,
    resolved_path: Option<ResolvedPath>,
    tunnel_url: Option<Arc<RwLock<Option<String>>>>,
}

impl AppCtxBuilder {
    pub(super) fn new(db: Db, data_dir: PathBuf) -> Self {
        Self {
            db,
            data_dir,
            git: None,
            services: None,
            broadcast: None,
            ws_clients: None,
            facade_hub: None,
            facade_heartbeat_interval_ms: None,
            adapter_registry: None,
            background_tasks: None,
            claude_workflows: None,
            chat_manager: None,
            launch_registry: None,
            tunnel_manager: None,
            port_tunnels: None,
            lsp_manager: None,
            plugin_manager: None,
            automations: None,
            orchestration: None,
            quota: None,
            version: None,
            port: None,
            auth_secret: None,
            resolved_path: None,
            tunnel_url: None,
        }
    }
    pub fn git(mut self, value: GitFactory) -> Self {
        self.git = Some(value);
        self
    }
    pub fn services(mut self, value: Services) -> Self {
        self.services = Some(value);
        self
    }
    pub fn broadcast(mut self, value: broadcast::Sender<DaemonEvent>) -> Self {
        self.broadcast = Some(value);
        self
    }
    pub fn ws_clients(mut self, value: WsClients) -> Self {
        self.ws_clients = Some(value);
        self
    }
    pub fn facade_hub(mut self, value: Arc<FacadeHub>) -> Self {
        self.facade_hub = Some(value);
        self
    }
    pub fn facade_heartbeat_interval_ms(mut self, value: u64) -> Self {
        self.facade_heartbeat_interval_ms = Some(value);
        self
    }
    pub fn adapter_registry(mut self, value: Arc<AdapterRegistry>) -> Self {
        self.adapter_registry = Some(value);
        self
    }
    pub fn background_tasks(mut self, value: Arc<BackgroundTaskTracker>) -> Self {
        self.background_tasks = Some(value);
        self
    }
    pub fn claude_workflows(mut self, value: Arc<ClaudeWorkflowStore>) -> Self {
        self.claude_workflows = Some(value);
        self
    }
    pub fn chat_manager(mut self, value: Option<Arc<ChatManager>>) -> Self {
        self.chat_manager = value;
        self
    }
    pub fn launch_registry(mut self, value: Option<Arc<LaunchRegistry>>) -> Self {
        self.launch_registry = value;
        self
    }
    pub fn tunnel_manager(mut self, value: Option<Arc<TunnelManager>>) -> Self {
        self.tunnel_manager = value;
        self
    }
    pub fn port_tunnels(mut self, value: Option<Arc<PortTunnelRegistry>>) -> Self {
        self.port_tunnels = value;
        self
    }
    pub fn lsp_manager(mut self, value: Option<Arc<LspManager>>) -> Self {
        self.lsp_manager = value;
        self
    }
    pub fn plugin_manager(mut self, value: Option<Arc<PluginManager>>) -> Self {
        self.plugin_manager = value;
        self
    }
    pub fn automations(mut self, value: Option<Arc<AutomationsEngine>>) -> Self {
        self.automations = Some(value);
        self
    }
    pub fn orchestration(mut self, value: Option<Arc<OrchestrationService>>) -> Self {
        self.orchestration = value;
        self
    }
    pub fn quota(mut self, value: Option<Arc<dyn QuotaService>>) -> Self {
        self.quota = value;
        self
    }
    pub fn version(mut self, value: String) -> Self {
        self.version = Some(value);
        self
    }
    pub fn port(mut self, value: u16) -> Self {
        self.port = Some(value);
        self
    }
    pub fn auth_secret(mut self, value: Option<String>) -> Self {
        self.auth_secret = Some(value);
        self
    }
    pub fn resolved_path(mut self, value: ResolvedPath) -> Self {
        self.resolved_path = Some(value);
        self
    }
    pub fn tunnel_url(mut self, value: Arc<RwLock<Option<String>>>) -> Self {
        self.tunnel_url = Some(value);
        self
    }
    pub fn build(self) -> AppCtx {
        self.assemble()
    }
}

mod assemble;
