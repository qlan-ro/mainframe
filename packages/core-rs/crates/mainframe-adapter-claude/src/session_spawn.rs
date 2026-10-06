use super::*;
impl ClaudeSession {
    pub async fn spawn(
        &self,
        options: SessionSpawnOptions,
        sink: Option<Arc<dyn SessionSink>>,
    ) -> Result<AdapterProcess, AdapterError> {
        let active_sink = sink.unwrap_or_else(|| Arc::new(NullSink));
        let (options, proxy_env) = self.endpoint_options(options).await?;
        let (options, executable, resume_target, include_partial) =
            self.probe_spawn_options(options).await?;
        let (args, base_mode) = build_args(&options, &resume_target, include_partial);
        *self
            .base_permission_mode
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = base_mode;

        let real = tokio::fs::canonicalize(&self.project_path)
            .await
            .map_err(|_| {
                AdapterError::Message(format!(
                    "Project directory does not exist or is not accessible: {}",
                    self.project_path
                ))
            })?;
        self.state().real_project_path = real.to_string_lossy().to_string();

        let mut cmd = build_spawn_command(
            &executable,
            &args,
            &self.project_path,
            self.resolved_path.as_str(),
            proxy_env.as_ref(),
        );
        crate::orchestration_args::apply_orchestration_env(
            &mut cmd,
            options.orchestration_mcp.as_ref(),
        );
        let mut child = cmd.spawn()?;

        let handle = self.bind_child(&child);
        self.start_stdin(child.stdin.take());
        self.apply_spawn_tuning(&options);
        self.start_output(child.stdout.take(), active_sink.clone(), handle_stdout);
        self.start_output(child.stderr.take(), active_sink.clone(), handle_stderr);
        self.wait_for_exit(child, handle, active_sink);
        self.get_process_info()
            .ok_or_else(|| AdapterError::Message("spawn produced no process info".to_string()))
    }
    async fn endpoint_options(
        &self,
        options: SessionSpawnOptions,
    ) -> Result<(SessionSpawnOptions, Option<CliProxyEnv>), AdapterError> {
        let endpoint_model = options
            .model
            .as_deref()
            .map(cliproxy::split_endpoint)
            .and_then(|(endpoint, bare)| endpoint.map(|_| bare.to_string()));
        let mut options = options;
        let proxy_env = match &endpoint_model {
            Some(bare) => {
                options.model = Some(bare.clone());
                Some(
                    cliproxy::resolve_env(None, options.small_fast_model.as_deref(), bare)
                        .await
                        .map_err(AdapterError::Message)?,
                )
            }
            None => None,
        };
        self.shared
            .endpoint
            .store(endpoint_model.is_some(), Ordering::SeqCst);

        Ok((options, proxy_env))
    }
    async fn probe_spawn_options(
        &self,
        mut options: SessionSpawnOptions,
    ) -> Result<(SessionSpawnOptions, String, crate::fork::ResumeTarget, bool), AdapterError> {
        let executable = options
            .executable_path
            .clone()
            .unwrap_or_else(|| "claude".to_string());

        *self.executable.lock().unwrap_or_else(|e| e.into_inner()) = executable.clone();
        let include_partial = crate::partial_stream::supports_partial_messages(
            &executable,
            self.resolved_path.as_str(),
        )
        .await;
        let resume_target = self.resume_target().await;
        if options.no_persistence != Some(true)
            && !matches!(resume_target, crate::fork::ResumeTarget::Fresh)
            && options
                .model
                .as_deref()
                .is_none_or(|model| model == "default")
        {
            options.model = Some(
                crate::effective_model::required_probe(
                    &executable,
                    self.resolved_path.as_str(),
                    &self.project_path,
                )
                .await?,
            );
        }
        Ok((options, executable, resume_target, include_partial))
    }
    fn apply_spawn_tuning(&self, options: &SessionSpawnOptions) {
        if let Some(tuning) = &options.tuning {
            let settings = tuning_to_flag_settings(tuning);
            if !settings.is_empty() {
                self.control.send(
                    self.stdin_clone().as_ref(),
                    &json!({ "subtype": "apply_flag_settings", "settings": settings }),
                );
            }
        }

        tracing::debug!(
            session_id = %self.id,
            project_path = %self.project_path,
            resume = self.resume_session_id.is_some(),
            model = options.model.as_deref().unwrap_or("default"),
            permission_mode = ?options.permission_mode,
            "claude session spawned"
        );
    }
}

pub(super) fn build_spawn_command(
    executable: &str,
    args: &[String],
    project_path: &str,
    resolved_path: &str,
    proxy: Option<&CliProxyEnv>,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(executable);
    cmd.args(args)
        .current_dir(project_path)
        .env("PATH", resolved_path)
        .env("FORCE_COLOR", "0")
        .env("NO_COLOR", "1")
        .env_remove("CLAUDECODE")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(proxy) = proxy {
        cmd.env("ANTHROPIC_BASE_URL", &proxy.base_url)
            .env("ANTHROPIC_AUTH_TOKEN", &proxy.auth_token)
            .env("ANTHROPIC_DEFAULT_HAIKU_MODEL", &proxy.small_fast_model)
            .env("ANTHROPIC_SMALL_FAST_MODEL", &proxy.small_fast_model)
            .env_remove("ANTHROPIC_API_KEY");
    }
    cmd
}

pub(super) fn build_args(
    options: &SessionSpawnOptions,
    resume: &crate::fork::ResumeTarget,
    include_partial_messages: bool,
) -> (Vec<String>, String) {
    let mut args: Vec<String> = [
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--verbose",
        "--permission-prompt-tool",
        "stdio",
        "--replay-user-messages",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if include_partial_messages {
        args.push("--include-partial-messages".to_string());
    }

    if options.system_prompt.as_deref() == Some("enabled") {
        args.push("--append-system-prompt".to_string());
        args.push(MAINFRAME_SYSTEM_PROMPT_APPEND.to_string());
    }

    append_resume_args(&mut args, options, resume);
    if let Some(m) = options.model.as_ref().filter(|m| m.as_str() != "default") {
        args.push("--model".to_string());
        args.push(m.clone());
    }
    let base_mode = options
        .permission_mode
        .map(execution_mode_cli)
        .unwrap_or("default")
        .to_string();
    let cli_mode = if options.plan_mode == Some(true) {
        "plan".to_string()
    } else {
        base_mode.clone()
    };
    args.push("--permission-mode".to_string());
    args.push(cli_mode);
    args.push("--allow-dangerously-skip-permissions".to_string());
    args.extend(crate::orchestration_args::orchestration_args(
        options.orchestration_mcp.as_ref(),
    ));
    (args, base_mode)
}

fn append_resume_args(
    args: &mut Vec<String>,
    options: &SessionSpawnOptions,
    resume: &crate::fork::ResumeTarget,
) {
    let no_persistence = options.no_persistence == Some(true);
    if no_persistence {
        args.push("--no-session-persistence".to_string());
    }
    let resume = if no_persistence {
        &crate::fork::ResumeTarget::Fresh
    } else {
        resume
    };
    match resume {
        crate::fork::ResumeTarget::Own(id) => {
            args.push("--resume".to_string());
            args.push(id.clone());
        }
        crate::fork::ResumeTarget::Fork(path) => {
            args.push("--resume".to_string());
            args.push(path.clone());
            args.push("--fork-session".to_string());
        }
        crate::fork::ResumeTarget::Fresh => {}
    }
}
