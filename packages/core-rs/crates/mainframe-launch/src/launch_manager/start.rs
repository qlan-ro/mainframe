use super::*;

impl LaunchManager {
    pub async fn start(&self, config: &LaunchConfiguration) -> Result<(), LaunchError> {
        let inner = &self.inner;
        let name = &config.name;
        if !self.wait_previous(name).await {
            return Ok(());
        }
        let gate = self.spawn_gate.lock().await;
        if *gate {
            return Err(LaunchError::ShuttingDown);
        }
        if inner.processes.contains_key(name) {
            tracing::warn!(target: "launch", name, "concurrent start already registered a process");
            return Ok(());
        }
        inner.state.reset(name);
        inner.emit_status(name, LaunchProcessStatus::Starting);
        let (executable, mut command) = self.command(config);
        let child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                drop(gate);
                return Err(self.spawn_failed(name, error).await);
            }
        };
        let (pid, status) = self.supervise(child, config);
        drop(gate);
        inner
            .record_spawn(name, pid, &executable, &config.runtime_args)
            .await;
        self.ready(config, &status).await;
        self.preview(config);
        Ok(())
    }

    async fn wait_previous(&self, name: &str) -> bool {
        let Some((status, mut exit_rx)) = self
            .inner
            .processes
            .get(name)
            .map(|managed| (*managed.status.lock_recover(), managed.exit_rx.clone()))
        else {
            return true;
        };
        if !matches!(
            status,
            LaunchProcessStatus::Stopped | LaunchProcessStatus::Failed
        ) {
            tracing::warn!(target: "launch", name, "process already running, skipping start");
            return false;
        }
        let teardown = self.inner.timings.stop_grace + Duration::from_secs(5);
        if tokio::time::timeout(teardown, wait_until_exited(&mut exit_rx))
            .await
            .is_err()
        {
            tracing::warn!(target: "launch", name, "previous process did not exit after SIGKILL, skipping start");
            return false;
        }
        true
    }

    fn command(&self, config: &LaunchConfiguration) -> (String, Command) {
        let inner = &self.inner;
        let executable = if config.runtime_executable.starts_with("./")
            || config.runtime_executable.starts_with("../")
        {
            lexical_resolve(&inner.project_path, &config.runtime_executable)
        } else {
            config.runtime_executable.clone()
        };
        let mut env =
            compose_launch_env(std::env::vars().collect(), inner.resolved_path.as_deref());
        if let Some(port) = config.port {
            env.insert("PORT".to_string(), port.to_string());
        }
        if let Some(config_env) = &config.env {
            env.extend(config_env.clone());
        }
        let mut command = Command::new(&executable);
        command
            .args(&config.runtime_args)
            .current_dir(&inner.project_path)
            .env_clear()
            .envs(&env)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .process_group(0);
        (executable, command)
    }

    async fn spawn_failed(&self, name: &str, error: std::io::Error) -> LaunchError {
        tracing::warn!(target: "launch", name, code = ?error.kind(), message = %error, "process error");
        self.inner
            .state
            .set_status(name, LaunchProcessStatus::Failed);
        self.inner.emit_status(name, LaunchProcessStatus::Failed);
        if let Some(tm) = &self.inner.tunnel_manager {
            tm.stop(&format!("preview:{name}")).await;
        }
        LaunchError::Spawn {
            name: name.to_string(),
            source: error,
        }
    }

    fn supervise(
        &self,
        mut child: tokio::process::Child,
        config: &LaunchConfiguration,
    ) -> (Option<u32>, Arc<Mutex<LaunchProcessStatus>>) {
        let inner = &self.inner;
        let name = &config.name;
        let pid = child.id();
        tracing::info!(target: "launch", name, ?pid, cmd = %format!("{} {}", config.runtime_executable, config.runtime_args.join(" ")), port = ?config.port, "launch process spawned");
        let status = Arc::new(Mutex::new(LaunchProcessStatus::Starting));
        let (exit_tx, exit_rx) = watch::channel(false);
        inner.processes.insert(
            name.clone(),
            ManagedProcess {
                status: status.clone(),
                pid,
                exit_rx,
            },
        );
        let tail = Arc::new(Mutex::new(TailBuffer::new(MAX_STDERR_LINES)));
        let pumps = self.pumps(&mut child, name, &tail);
        tokio::spawn(wait_for_exit_task(
            child,
            inner.clone(),
            name.clone(),
            pid,
            status.clone(),
            tail,
            exit_tx,
            pumps,
        ));
        (pid, status)
    }

    fn pumps(
        &self,
        child: &mut tokio::process::Child,
        name: &str,
        tail: &Arc<Mutex<TailBuffer>>,
    ) -> Vec<tokio::task::JoinHandle<()>> {
        let mut pumps = Vec::new();
        if let Some(stdout) = child.stdout.take() {
            pumps.push(pump_output(
                stdout,
                self.inner.clone(),
                name.to_string(),
                LaunchStream::Stdout,
                None,
            ));
        }
        if let Some(stderr) = child.stderr.take() {
            pumps.push(pump_output(
                stderr,
                self.inner.clone(),
                name.to_string(),
                LaunchStream::Stderr,
                Some(tail.clone()),
            ));
        }
        pumps
    }

    async fn ready(&self, config: &LaunchConfiguration, status: &Arc<Mutex<LaunchProcessStatus>>) {
        let inner = &self.inner;
        let name = &config.name;
        if let Some(port) = config.port {
            tracing::info!(target: "launch", name, port, "waiting for port to become ready…");
            if wait_for_port(port as u16, status, &inner.timings).await {
                (inner.on_event)(DaemonEvent::LaunchPortTimeout {
                    project_id: inner.project_id.clone(),
                    effective_path: inner.project_path.clone(),
                    name: name.clone(),
                    port,
                });
            }
        }
        let mut guard = status.lock_recover();
        if *guard == LaunchProcessStatus::Starting {
            *guard = LaunchProcessStatus::Running;
            inner.state.set_status(name, LaunchProcessStatus::Running);
            inner.emit_status(name, LaunchProcessStatus::Running);
            tracing::info!(target: "launch", name, port = ?config.port, "launch process ready");
        }
    }

    fn preview(&self, config: &LaunchConfiguration) {
        if config.preview != Some(true) {
            return;
        }
        let (Some(port), Some(tunnel)) = (config.port, self.inner.tunnel_manager.clone()) else {
            return;
        };
        let inner = self.inner.clone();
        let name = config.name.clone();
        tokio::spawn(async move {
            let event = match tunnel
                .start(port as u16, &format!("preview:{name}"), None)
                .await
            {
                Ok(url) => DaemonEvent::LaunchTunnel {
                    project_id: inner.project_id.clone(),
                    effective_path: inner.project_path.clone(),
                    name,
                    url,
                },
                Err(error) => {
                    tracing::warn!(target: "launch", name, err = %error, "tunnel failed to start");
                    DaemonEvent::LaunchTunnelFailed {
                        project_id: inner.project_id.clone(),
                        effective_path: inner.project_path.clone(),
                        name,
                        error,
                    }
                }
            };
            (inner.on_event)(event);
        });
    }
}
