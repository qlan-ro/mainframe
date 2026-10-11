use super::*;

pub struct ReadyDaemon {
    daemon: Daemon,
    liveness: mainframe_background_tasks::liveness::LivenessSchedulerHandle,
    _quota_scheduler: ClaudeQuotaScheduler,
}

impl Daemon {
    pub async fn post_bind(self) -> ReadyDaemon {
        info!(addr = %format!("127.0.0.1:{}", self.ctx.core.port), version = %self.ctx.core.version, "mainframe-daemon listening");
        // Bind is the single-instance guard; sweep before spawning our tunnel.
        let sweep =
            sweep_stray_children(self.handles.child_registry.as_ref(), &default_sweep_deps()).await;
        if sweep.reaped > 0 || sweep.skipped > 0 {
            info!(
                total = sweep.total,
                reaped = sweep.reaped,
                skipped = sweep.skipped,
                "stray child process sweep complete"
            );
        }
        let liveness = start_liveness_scheduler(LivenessDeps {
            tracker: self.ctx.core.background_tasks.clone(),
            interval_ms: None,
        });
        spawn_reconcile(
            self.ctx.core.db.clone(),
            self.ctx.core.background_tasks.clone(),
        );
        self.ctx.chat.orchestration.reconcile_boot().await;
        spawn_worktree_backfill(self.ctx.core.db.clone());
        self.start_catalog_refresh();
        let quota_scheduler = self.start_quota_scheduler();
        self.start_tunnel().await;
        ReadyDaemon {
            daemon: self,
            liveness,
            _quota_scheduler: quota_scheduler,
        }
    }

    fn start_catalog_refresh(&self) {
        let adapters = self.ctx.core.adapter_registry.clone();
        adapters.allow_refresh();
        tokio::spawn(async move {
            adapters.refresh_all().await;
        });
    }

    fn start_quota_scheduler(&self) -> ClaudeQuotaScheduler {
        let quota = self.handles.quota_manager.clone();
        let clients = self.ctx.infra.ws_clients.clone();
        let mut scheduler = ClaudeQuotaScheduler::new(ClaudeQuotaSchedulerDeps {
            refresh: Arc::new(move || {
                let quota = quota.clone();
                Box::pin(async move {
                    quota.refresh("claude").await;
                    Ok::<(), SeamError>(())
                })
            }),
            has_clients: Arc::new(move || !clients.is_empty()),
            interval_ms: None,
        });
        scheduler.start();
        let quota = self.handles.quota_manager.clone();
        tokio::spawn(async move {
            quota.refresh("codex").await;
        });
        scheduler
    }

    async fn start_tunnel(&self) {
        let config = &self.config;
        if config.tunnel == Some(true) {
            let options = config.tunnel_token.clone().map(|token| TunnelStartOptions {
                token: Some(token),
                url: config.tunnel_url.clone(),
            });
            match self
                .ctx
                .infra
                .tunnel_manager
                .start(self.ctx.core.port, "daemon", options)
                .await
            {
                Ok(url) => {
                    self.ctx.set_tunnel_url(Some(url.clone()));
                    info!(tunnel_url = %url, "Daemon tunnel started");
                    tracing::warn!(
                        "Daemon is publicly accessible via tunnel — do not share this URL in untrusted environments"
                    );
                }
                Err(error) => {
                    tracing::error!(%error, "Failed to start daemon tunnel — continuing without tunnel")
                }
            }
        } else if let Some(url) = config.tunnel_url.clone() {
            self.ctx.set_tunnel_url(Some(url.clone()));
            info!(tunnel_url = %url, "Using configured tunnel URL (no auto-start)");
        }
    }

    pub async fn serve(self, signal: impl Future<Output = ()>) -> std::io::Result<()> {
        self.post_bind().await.serve(signal).await
    }

    async fn shutdown(ctx: Arc<AppCtx>, handles: DaemonHandles) {
        info!("Shutting down...");
        if let Some(automations) = &ctx.services.automations {
            automations.stop();
        }
        ctx.chat.orchestration.credentials().revoke_all();
        handles.orchestration_events.abort();
        ctx.chat.chat_manager.dispose();
        ctx.infra.plugin_manager.unload_all();
        ctx.core.adapter_registry.kill_all();
        tokio::join!(
            shutdown_launches_and_tunnels(&ctx.infra.launch_registry, &ctx.infra.tunnel_manager),
            ctx.infra.lsp_manager.shutdown_all()
        );
        drop(handles.keepalive);
    }
}

impl ReadyDaemon {
    pub async fn serve(self, signal: impl Future<Output = ()>) -> std::io::Result<()> {
        let daemon = self.daemon;
        spawn_broadcast_pump(daemon.ctx.clone());
        let app = build_app(daemon.ctx.clone());
        info!(port = daemon.ctx.core.port, "Daemon ready");
        crate::wiring::shutdown::serve(daemon.listener, app, signal, async {
            Daemon::shutdown(daemon.ctx, daemon.handles).await;
            self.liveness.stop();
        })
        .await
    }
}
