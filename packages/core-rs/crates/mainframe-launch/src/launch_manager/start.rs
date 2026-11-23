use super::*;

/// A supervised launch child whose pid is not recorded yet.
struct Spawned {
    inner: Arc<Inner>,
    pid: Option<u32>,
    status: Arc<Mutex<LaunchProcessStatus>>,
    executable: String,
    /// Fired once the pid is recorded; the exit watcher forgets it only then.
    recorded_tx: oneshot::Sender<()>,
}

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
            tracing::warn!(name, "concurrent start already registered a process");
            return Ok(());
        }
        let generation = inner.begin_generation(name);
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
        let spawned = self.register(child, config, generation, executable);
        drop(gate);
        // A task, so a caller that stops waiting (a dropped HTTP request)
        // cannot leave the child unrecorded, `starting` forever, or without
        // its preview tunnel.
        if let Err(error) = tokio::spawn(settle(spawned, config.clone())).await {
            tracing::warn!(name, %error, "launch start task failed");
        }
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
            tracing::warn!(name, "process already running, skipping start");
            return false;
        }
        let teardown = self.inner.timings.stop_grace + Duration::from_secs(5);
        if tokio::time::timeout(teardown, wait_until_exited(&mut exit_rx))
            .await
            .is_err()
        {
            tracing::warn!(
                name,
                "previous process did not exit after SIGKILL, skipping start"
            );
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
        tracing::warn!(name, code = ?error.kind(), message = %error, "process error");
        self.inner
            .state
            .set_status(name, LaunchProcessStatus::Failed);
        self.inner.emit_status(name, LaunchProcessStatus::Failed);
        self.inner.stop_preview(name).await;
        LaunchError::Spawn {
            name: name.to_string(),
            source: error,
        }
    }

    /// Publish the child in the process map, drain its output and hand it to
    /// its exit watcher. Call under the spawn gate.
    fn register(
        &self,
        mut child: tokio::process::Child,
        config: &LaunchConfiguration,
        generation: u64,
        executable: String,
    ) -> Spawned {
        let inner = &self.inner;
        let name = &config.name;
        let pid = child.id();
        tracing::info!(name, ?pid, cmd = %format!("{} {}", config.runtime_executable, config.runtime_args.join(" ")), port = ?config.port, "launch process spawned");
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
        let (recorded_tx, recorded) = oneshot::channel();
        tokio::spawn(wait_for_exit_task(
            child,
            ExitWatch {
                inner: inner.clone(),
                spawn_gate: self.spawn_gate.clone(),
                name: name.clone(),
                generation,
                pid,
                status: status.clone(),
                stderr_tail: tail,
                exit_tx,
                recorded,
            },
            pumps,
        ));
        Spawned {
            inner: inner.clone(),
            pid,
            status,
            executable,
            recorded_tx,
        }
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
}

/// Record the pid, wait for the port and start the preview tunnel.
async fn settle(spawned: Spawned, config: LaunchConfiguration) {
    let Spawned {
        inner,
        pid,
        status,
        executable,
        recorded_tx,
    } = spawned;
    inner
        .record_spawn(&config.name, pid, &executable, &config.runtime_args)
        .await;
    let _ = recorded_tx.send(()); /* expected: Err when the watcher already ended */
    let port = tcp_port(&config);
    let running = inner.ready(&config.name, port, &status).await;
    // A process stopped or failed while its port was awaited gets no tunnel.
    if running
        && config.preview == Some(true)
        && let Some(port) = port
    {
        inner.start_preview(&config.name, port);
    }
}
