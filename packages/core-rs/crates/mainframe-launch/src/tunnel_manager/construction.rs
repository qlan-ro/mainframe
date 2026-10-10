use super::*;

impl TunnelManager {
    pub fn new(broadcast: Option<BroadcastFn>) -> Self {
        Self::with_config(broadcast, TunnelConfig::default())
    }

    pub fn with_config(broadcast: Option<BroadcastFn>, config: TunnelConfig) -> Self {
        Self {
            tunnels: Arc::new(DashMap::new()),
            live: Arc::new(StdMutex::new(HashMap::new())),
            next_id: AtomicU64::new(0),
            verified_at: Arc::new(DashMap::new()),
            broadcast: broadcast.unwrap_or_else(|| Arc::new(|_event| {})),
            config,
            client: reqwest::Client::new(),
            registry: Arc::new(NoopChildRegistry),
            resolved_path: None,
            signal: kill_signal(),
        }
    }

    /// Construct with a child registry + spawn-binary path.
    /// `cloudflared_path` sets the spawned binary (default bare `cloudflared`).
    pub fn with_options(broadcast: Option<BroadcastFn>, options: TunnelManagerOptions) -> Self {
        let mut config = TunnelConfig::default();
        if let Some(path) = options.cloudflared_path {
            config.cloudflared_bin = path;
        }
        let mut manager = Self::with_config(broadcast, config);
        if let Some(registry) = options.registry {
            manager.registry = registry;
        }
        manager
    }

    /// Inject the boot-resolved login-shell `PATH` (see
    /// `mainframe_runtime::ResolvedPath`) applied to the `cloudflared` spawn.
    #[must_use]
    pub fn with_resolved_path(mut self, path: impl Into<String>) -> Self {
        self.resolved_path = Some(path.into());
        self
    }

    pub(super) fn lock_live(&self) -> MutexGuard<'_, HashMap<u64, TunnelProcess>> {
        self.live.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
