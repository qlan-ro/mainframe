use super::*;

/// The config's port as a TCP port. `parse_launch_config` only admits
/// 1–65535, so `None` here means no port was configured.
pub(super) fn tcp_port(config: &LaunchConfiguration) -> Option<u16> {
    let port = config.port?;
    let tcp = u16::try_from(port).ok();
    if tcp.is_none() {
        tracing::warn!(name = %config.name, port, "launch port is out of range; ignoring it");
    }
    tcp
}

impl Inner {
    /// Wait for the port, then mark a still-starting process `running`.
    /// Returns whether the process is running, i.e. was not stopped and did
    /// not fail meanwhile.
    pub(super) async fn ready(
        &self,
        name: &str,
        port: Option<u16>,
        status: &Arc<Mutex<LaunchProcessStatus>>,
    ) -> bool {
        if let Some(port) = port {
            tracing::info!(name, port, "waiting for port to become ready…");
            if wait_for_port(port, status, &self.timings).await {
                (self.on_event)(DaemonEvent::LaunchPortTimeout {
                    project_id: self.project_id.clone(),
                    effective_path: self.project_path.clone(),
                    name: name.to_string(),
                    port: i64::from(port),
                });
            }
        }
        let mut guard = status.lock_recover();
        if *guard == LaunchProcessStatus::Starting {
            *guard = LaunchProcessStatus::Running;
            self.state.set_status(name, LaunchProcessStatus::Running);
            self.emit_status(name, LaunchProcessStatus::Running);
            tracing::info!(name, ?port, "launch process ready");
        }
        *guard == LaunchProcessStatus::Running
    }

    pub(super) fn start_preview(self: &Arc<Self>, name: &str, port: u16) {
        let Some(tunnel) = self.tunnel_manager.clone() else {
            return;
        };
        let inner = self.clone();
        let name = name.to_string();
        tokio::spawn(async move {
            let event = match tunnel.start(port, &preview_label(&name), None).await {
                Ok(url) => DaemonEvent::LaunchTunnel {
                    project_id: inner.project_id.clone(),
                    effective_path: inner.project_path.clone(),
                    name,
                    url,
                },
                Err(error) => {
                    tracing::warn!(name, error = %error, "tunnel failed to start");
                    DaemonEvent::LaunchTunnelFailed {
                        project_id: inner.project_id.clone(),
                        effective_path: inner.project_path.clone(),
                        name,
                        error: error.to_string(),
                    }
                }
            };
            (inner.on_event)(event);
        });
    }

    pub(super) async fn stop_preview(&self, name: &str) {
        if let Some(tunnel) = &self.tunnel_manager {
            tunnel.stop(&preview_label(name)).await;
        }
    }
}

fn preview_label(name: &str) -> String {
    format!("preview:{name}")
}
