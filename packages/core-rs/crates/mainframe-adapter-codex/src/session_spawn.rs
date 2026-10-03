use super::*;
impl CodexSession {
    pub(super) async fn spawn_inner(
        &self,
        options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> Result<AdapterProcess, AdapterError> {
        let (options, sink) = self.configure_spawn(options, sink);
        if std::fs::metadata(&self.project_path).is_err() {
            return Err(AdapterError::Message(format!(
                "Project directory does not exist or is not accessible: {}",
                self.project_path
            )));
        }

        let child = self.spawn_process(&options)?;
        let approval = Arc::new(ApprovalHandler::new(sink.clone()));
        *self
            .approval_handler
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(approval.clone());

        let handlers = self.build_handlers(approval);
        let client = Arc::new(JsonRpcClient::new(child, handlers));
        *self.client.lock().unwrap_or_else(|e| e.into_inner()) = Some(client.clone());
        self.initialize_client(&client, &*sink).await?;

        tracing::info!(
            module = "codex:session",
            session_id = %self.id,
            project_path = %self.project_path,
            resume = self.resume_thread_id.is_some(),
            "codex session spawned"
        );
        sink.on_init(&self.id);

        self.get_process_info()
            .ok_or_else(|| AdapterError::Message("no process info".to_string()))
    }
    fn configure_spawn(
        &self,
        options: Option<SessionSpawnOptions>,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> (SessionSpawnOptions, Arc<dyn SessionSink>) {
        let options = options.unwrap_or(SessionSpawnOptions {
            model: None,
            permission_mode: None,
            plan_mode: None,
            executable_path: None,
            system_prompt: None,
            tuning: None,
            small_fast_model: None,
            default_model: None,
            no_persistence: None,
        });
        let sink = sink.unwrap_or_else(null_sink);
        *self.sink.lock().unwrap_or_else(|e| e.into_inner()) = sink.clone();
        {
            let mut cfg = self.config.lock().unwrap_or_else(|e| e.into_inner());
            cfg.model = model::explicit_model(options.model.as_deref());
            cfg.permission_mode = options.permission_mode.unwrap_or(ExecutionMode::Default);
            cfg.plan_mode = options.plan_mode.unwrap_or(false);
            cfg.tuning = options.tuning.clone();
            cfg.no_persistence = options.no_persistence.unwrap_or(false);
        }

        (options, sink)
    }

    async fn initialize_client(
        &self,
        client: &JsonRpcClient,
        sink: &dyn SessionSink,
    ) -> Result<(), AdapterError> {
        match tokio::time::timeout(
            Duration::from_millis(HANDSHAKE_TIMEOUT_MS),
            client.request("initialize", Some(initialize_params(true))),
        )
        .await
        {
            Ok(Ok(_)) => {
                client.notify("initialized", None);
                *self.status.lock().unwrap_or_else(|e| e.into_inner()) =
                    AdapterProcessStatus::Ready;
            }
            Ok(Err(e)) => return Err(AdapterError::Message(e.0)),
            Err(_) => {
                tracing::error!(module = "codex:session", session_id = %self.id, "codex handshake timeout");
                sink.on_error(AdapterError::Message("handshake timeout".to_string()));
                client.close();
                return Err(AdapterError::Message("handshake timeout".to_string()));
            }
        }
        Ok(())
    }
    fn spawn_process(
        &self,
        options: &SessionSpawnOptions,
    ) -> Result<tokio::process::Child, AdapterError> {
        let executable = options
            .executable_path
            .clone()
            .unwrap_or_else(|| "codex".to_string());
        *self
            .history_executable
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = executable.clone();
        let mut cmd = build_app_server_command(
            &executable,
            Some(Path::new(&self.project_path)),
            self.resolved_path.as_str(),
        );
        let child = cmd
            .spawn()
            .map_err(|e| AdapterError::Message(e.to_string()))?;
        self.pid
            .store(child.id().map(|p| p as i64).unwrap_or(0), Ordering::SeqCst);
        *self.status.lock().unwrap_or_else(|e| e.into_inner()) = AdapterProcessStatus::Starting;

        Ok(child)
    }
}

pub(super) fn initialize_params(with_capabilities: bool) -> Value {
    let mut m = Map::new();
    m.insert(
        "clientInfo".into(),
        json!({ "name": "mainframe", "title": "Mainframe", "version": "1.0.0" }),
    );
    if with_capabilities {
        m.insert("capabilities".into(), json!({ "experimentalApi": true }));
    }
    Value::Object(m)
}

pub(super) fn build_app_server_command(
    executable: &str,
    cwd: Option<&Path>,
    path: &str,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(executable);
    cmd.arg("app-server")
        .env("PATH", path)
        .env("FORCE_COLOR", "0")
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd
}

pub(crate) async fn spawn_temp_app_server(
    executable: &str,
    cwd: Option<&Path>,
    with_capabilities: bool,
    path: &str,
) -> Result<Arc<JsonRpcClient>, AdapterError> {
    let mut cmd = build_app_server_command(executable, cwd, path);
    let child = cmd
        .spawn()
        .map_err(|e| AdapterError::Message(e.to_string()))?;
    let client = Arc::new(JsonRpcClient::new(
        child,
        JsonRpcHandlers {
            on_notification: Box::new(|_, _| {}),
            on_request: Box::new(|_, _, _| {}),
            on_error: Box::new(|_| {}),
            on_exit: Box::new(|_| {}),
        },
    ));
    client
        .request("initialize", Some(initialize_params(with_capabilities)))
        .await
        .map_err(|e| AdapterError::Message(e.0))?;
    client.notify("initialized", None);
    Ok(client)
}
