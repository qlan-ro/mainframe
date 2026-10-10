use super::*;

impl LaunchManager {
    pub fn new(
        project_id: impl Into<String>,
        project_path: impl Into<String>,
        on_event: BroadcastFn,
        tunnel_manager: Option<Arc<TunnelManager>>,
        resolved_path: Option<mainframe_runtime::ResolvedPath>,
        child_registry: Option<Arc<dyn ChildRegistryPort>>,
    ) -> Self {
        Self::with_timings(
            project_id,
            project_path,
            on_event,
            tunnel_manager,
            resolved_path,
            child_registry,
            default_read_command(),
            LaunchTimings::default(),
        )
    }

    /// Like `new`, but with an injectable `read_process_command` (the sweep
    /// identity reader).
    #[cfg(test)]
    pub(crate) fn with_read_command(
        project_id: impl Into<String>,
        project_path: impl Into<String>,
        on_event: BroadcastFn,
        tunnel_manager: Option<Arc<TunnelManager>>,
        resolved_path: Option<mainframe_runtime::ResolvedPath>,
        child_registry: Option<Arc<dyn ChildRegistryPort>>,
        read_process_command: ReadCommandFn,
    ) -> Self {
        Self::with_timings(
            project_id,
            project_path,
            on_event,
            tunnel_manager,
            resolved_path,
            child_registry,
            read_process_command,
            LaunchTimings::default(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn with_timings(
        project_id: impl Into<String>,
        project_path: impl Into<String>,
        on_event: BroadcastFn,
        tunnel_manager: Option<Arc<TunnelManager>>,
        resolved_path: Option<mainframe_runtime::ResolvedPath>,
        child_registry: Option<Arc<dyn ChildRegistryPort>>,
        read_process_command: ReadCommandFn,
        timings: LaunchTimings,
    ) -> Self {
        Self {
            spawn_gate: Arc::new(tokio::sync::Mutex::new(false)),
            inner: Arc::new(Inner {
                project_id: project_id.into(),
                project_path: project_path.into(),
                on_event,
                tunnel_manager,
                processes: DashMap::new(),
                state: LaunchProcessState::new(),
                timings,
                child_registry,
                read_process_command,
                resolved_path,
            }),
        }
    }

    pub(crate) fn with_spawn_gate(mut self, gate: Arc<tokio::sync::Mutex<bool>>) -> Self {
        self.spawn_gate = gate;
        self
    }
}
