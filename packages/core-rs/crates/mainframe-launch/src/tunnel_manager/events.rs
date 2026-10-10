use super::*;

impl TunnelManager {
    pub(super) fn scan_line(
        &self,
        line: &str,
        is_named: bool,
        label: &str,
        pending_url: &mut Option<String>,
        registered: &mut bool,
    ) {
        if !is_named
            && pending_url.is_none()
            && let Some(url) = Self::parse_url(line)
        {
            tracing::debug!(target: "tunnel", label, url, "tunnel URL received, waiting for connection registration…");
            *pending_url = Some(url);
        }
        if !*registered && line.contains(REGISTERED_MARKER) {
            tracing::debug!(target: "tunnel", label, "tunnel connection registered");
            *registered = true;
        }
    }

    pub(super) fn on_exit_before_ready(&self, label: &str, exit: TunnelExit) -> String {
        let code = exit
            .code
            .map(|c| c.to_string())
            .unwrap_or_else(|| "null".to_string());
        let msg = format!("Tunnel \"{label}\" process exited before ready (code {code})");
        self.broadcast(DaemonEvent::TunnelStatus {
            state: TunnelState::Error,
            label: label.to_string(),
            url: None,
            dns_verified: None,
            error: Some(msg.clone()),
        });
        msg
    }

    /// Post-ready exit handling (TS `child.once('exit')` `else` branch): remove
    /// the tunnel and broadcast `stopped` when the established child dies on its
    /// own. A tunnel removed by `stop`, or since respawned under the same label,
    /// is left alone.
    pub(super) fn spawn_exit_watcher(&self, label: String, process: TunnelProcess) {
        let tunnels = self.tunnels.clone();
        let broadcast = self.broadcast.clone();
        tokio::spawn(async move {
            let exit = process.exited().await;
            tracing::info!(target: "tunnel", label = %label, code = ?exit.code, "tunnel process exited");
            if tunnels
                .remove_if(&label, |_, tunnel| tunnel.process.id == process.id)
                .is_some()
            {
                broadcast(DaemonEvent::TunnelStatus {
                    state: TunnelState::Stopped,
                    label,
                    url: None,
                    dns_verified: None,
                    error: None,
                });
            }
        });
    }
}
