use super::*;

impl TunnelManager {
    /// Extract a `https://<label>.trycloudflare.com` URL from a log line, or
    /// `None`. Mirrors `/https:\/\/[a-z0-9-]+\.trycloudflare\.com/` — the label
    /// class is `[a-z0-9-]` (no `.`), so it stops at the first dot.
    pub(crate) fn parse_url(line: &str) -> Option<String> {
        let mut search_from = 0;
        while let Some(rel) = line[search_from..].find("https://") {
            let start = search_from + rel;
            let after = &line[start + "https://".len()..];
            let label_len: usize = after
                .chars()
                .take_while(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-')
                .map(char::len_utf8)
                .sum();
            if label_len > 0 {
                let rest = &after[label_len..];
                if rest.starts_with(".trycloudflare.com") {
                    let label = &after[..label_len];
                    return Some(format!("https://{label}.trycloudflare.com"));
                }
            }
            search_from = start + "https://".len();
        }
        None
    }

    pub async fn start(
        &self,
        port: u16,
        label: &str,
        options: Option<TunnelStartOptions>,
    ) -> Result<String, String> {
        // Stop any existing tunnel for this label to prevent leaks.
        self.stop(label).await;

        let gate = self.spawn_gate.lock().await;
        if *gate {
            return Err("Daemon is shutting down".to_string());
        }

        let options = options.unwrap_or_default();
        let is_named = options.token.is_some();

        self.broadcast(DaemonEvent::TunnelStatus {
            state: TunnelState::Starting,
            label: label.to_string(),
            url: None,
            dns_verified: None,
            error: None,
        });

        let args: Vec<String> = if is_named {
            vec![
                "tunnel".to_string(),
                "run".to_string(),
                "--token".to_string(),
                options.token.clone().unwrap_or_default(),
            ]
        } else {
            vec![
                "tunnel".to_string(),
                "--url".to_string(),
                format!("http://localhost:{port}"),
            ]
        };

        let mut child = match build_cloudflared_command(
            &self.config.cloudflared_bin,
            &args,
            self.resolved_path.as_deref(),
        )
        .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                let message = if err.kind() == std::io::ErrorKind::NotFound {
                    CLOUDFLARED_NOT_FOUND.to_string()
                } else {
                    err.to_string()
                };
                self.broadcast(DaemonEvent::TunnelStatus {
                    state: TunnelState::Error,
                    label: label.to_string(),
                    url: None,
                    dns_verified: None,
                    error: Some(message.clone()),
                });
                return Err(message);
            }
        };

        let mut out_lines = child.stdout.take().map(|s| BufReader::new(s).lines());
        let mut err_lines = child.stderr.take().map(|s| BufReader::new(s).lines());
        // Tracked in `live` (and its reap pid recorded) BEFORE the start window,
        // so a shutdown or crash during it can reap the child (see stop_all).
        let process = self.watch_child(child, label);
        drop(gate);
        let mut guard = StartGuard {
            tunnels: &self.tunnels,
            label,
            process: &process,
            armed: true,
        };

        let mut pending_url: Option<String> = if is_named { options.url.clone() } else { None };
        let mut registered = false;

        let start_deadline = sleep(self.config.start_timeout);
        tokio::pin!(start_deadline);

        // Step 1: wait for URL + registration (or timeout / early exit).
        loop {
            if pending_url.is_some() && registered {
                break;
            }
            tokio::select! {
                line = next_line_stdout(&mut out_lines) => {
                    if let Some(line) = line {
                        self.scan_line(&line, is_named, label, &mut pending_url, &mut registered);
                    }
                }
                line = next_line_stderr(&mut err_lines) => {
                    if let Some(line) = line {
                        self.scan_line(&line, is_named, label, &mut pending_url, &mut registered);
                    }
                }
                () = &mut start_deadline => {
                    process.terminate(self.config.stop_grace).await;
                    let msg = format!(
                        "Tunnel \"{label}\" timed out after {}ms",
                        self.config.start_timeout.as_millis()
                    );
                    self.broadcast(DaemonEvent::TunnelStatus {
                        state: TunnelState::Error,
                        label: label.to_string(),
                        url: None,
                        dns_verified: None,
                        error: Some(msg.clone()),
                    });
                    return Err(msg);
                }
                exit = process.exited() => {
                    return Err(self.on_exit_before_ready(label, exit));
                }
            }
        }

        // Keep reading the child's output for its whole life: dropping the pipe
        // readers closes the pipes, and cloudflared (Go) dies on SIGPIPE at its
        // next log write.
        spawn_output_drain(out_lines, err_lines);

        // Step 2: connected. Register the tunnel, then wait for DNS while still
        // watching for an early exit (which fails the start).
        let url = pending_url.unwrap_or_default();
        self.tunnels.insert(
            label.to_string(),
            ManagedTunnel {
                process: process.clone(),
                url: url.clone(),
                ready: false,
            },
        );
        tracing::info!(target: "tunnel", label, url, port, "tunnel connected, waiting for DNS propagation…");
        self.broadcast(DaemonEvent::TunnelStatus {
            state: TunnelState::Ready,
            label: label.to_string(),
            url: Some(url.clone()),
            dns_verified: Some(false),
            error: None,
        });

        tokio::select! {
            dns_ok = self.wait_for_dns(&url) => {
                if let Some(mut tunnel) = self.tunnels.get_mut(label) {
                    tunnel.ready = true;
                }
                if dns_ok {
                    tracing::info!(target: "tunnel", label, url, "tunnel ready (DNS verified)");
                } else {
                    tracing::warn!(target: "tunnel", label, url, "tunnel DNS verification timed out, emitting anyway");
                }
                self.broadcast(DaemonEvent::TunnelStatus {
                    state: TunnelState::DnsVerified,
                    label: label.to_string(),
                    url: Some(url.clone()),
                    dns_verified: Some(dns_ok),
                    error: None,
                });
                guard.armed = false;
                self.spawn_exit_watcher(label.to_string(), process.clone());
                Ok(url)
            }
            exit = process.exited() => Err(self.on_exit_before_ready(label, exit)),
        }
    }
}
