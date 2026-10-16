use super::*;

impl Adapter for CodexAdapter {
    fn get_context_files(&self, project_path: &str) -> Option<mainframe_adapter_api::ContextFiles> {
        Some(crate::context_files::collect_codex_context_files(
            project_path,
        ))
    }

    fn external_sessions(&self) -> Option<Arc<dyn mainframe_adapter_api::ExternalSessions>> {
        Some(Arc::new(crate::external_sessions_provider::Provider))
    }
    fn read_tool_result(&self, path: String, tool_id: String) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move {
            crate::read_tool_result_from_rollout::read_tool_result_from_rollout(&path, &tool_id)
                .await
        })
    }

    fn quota_source(&self) -> Option<Arc<dyn mainframe_adapter_api::QuotaSource>> {
        Some(Arc::new(crate::quota_source::Source))
    }

    fn skills(&self) -> Option<Arc<dyn mainframe_adapter_api::SkillsProvider>> {
        Some(Arc::new(crate::skills_provider::Provider(
            self.resolved_path.clone(),
        )))
    }

    fn display_decoders(&self) -> Arc<dyn mainframe_display::ToolResultDecoders> {
        Arc::new(mainframe_display::decoders::MainframeDecoders)
    }

    fn id(&self) -> &str {
        "codex"
    }
    fn name(&self) -> &str {
        "Codex"
    }
    fn supports_steer(&self) -> bool {
        true
    }
    fn capabilities(&self) -> AdapterCapabilities {
        let version = self.observed_version.lock_recover().clone();
        AdapterCapabilities {
            plan_mode: true,
            auto_mode: false,
            // Verified interactively on 0.155.1: thread/start ephemeral:true alongside
            // Mainframe's persist-history params keeps four-turn streaming, an approval
            // gate and an interrupt working, with no rollout file or threads row. See
            // docs/research/adapters/codex/CONSUMED-SURFACE.md.
            no_persistence: true,
            // True only on a CLI with the `thread/fork` `lastTurnId` surface —
            // `None` (never refreshed, or version undetermined) is `false`.
            fork: version.as_deref().is_some_and(fork_supported),
        }
    }

    /// The registry calls this once per refresh (before
    /// `apply_refresh`), on both the primary and fallback version-detection
    /// path, so `capabilities().fork`'s version gate stays synchronous.
    fn observe_cli_version(&self, version: Option<&str>) {
        *self.observed_version.lock_recover() = version.map(str::to_string);
    }

    fn fork_unavailable_reason(&self) -> Option<String> {
        let version = self.observed_version.lock_recover().clone();
        fork_unavailable_reason_for(version.as_deref())
    }

    /// Pin a fork's starting point: read the parent thread through a
    /// temporary app-server and pin its last turn id. Writes nothing to
    /// `request.dest_dir` — Codex's `thread/fork` needs no on-disk snapshot.
    fn pin_fork_point(
        &self,
        request: ForkPinRequest,
    ) -> BoxFuture<'_, Result<ForkSource, ForkPinError>> {
        let path = self.resolved_path.clone();
        let executable = self.pin_executable.lock_recover().clone();
        Box::pin(async move { pin_fork_point(request, &executable, path.as_str()).await })
    }

    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        let path = self.resolved_path.clone();
        Box::pin(async move {
            Ok(
                mainframe_adapter_api::version::version_stdout("codex", &path)
                    .await
                    .is_some(),
            )
        })
    }

    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        let path = self.resolved_path.clone();
        Box::pin(async move {
            let Some(stdout) = mainframe_adapter_api::version::version_stdout("codex", &path).await
            else {
                return Ok(None);
            };
            Ok(Some(
                mainframe_adapter_api::version::CliVersion::parse(&stdout)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| stdout.trim().to_string()),
            ))
        })
    }

    fn catalog(&self) -> Vec<AdapterModel> {
        self.cached_models
            .lock_recover()
            .clone()
            .unwrap_or_default()
    }

    fn invalidate_catalog(&self) {
        *self.cached_models.lock_recover() = None;
    }

    /// `probeModels(executablePath?)` — probe with the configured Codex binary
    /// (#430). Delegates to `load_models`, which caches non-empty catalogs.
    fn refresh_catalog(
        &self,
        executable_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<Vec<AdapterModel>>, AdapterError>> {
        Box::pin(async move {
            let exe = executable_path.unwrap_or_else(|| "codex".to_string());
            Ok(Some(self.load_models(&exe).await))
        })
    }

    fn generate_title(
        &self,
        content: String,
        binary: String,
    ) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        let path = self.resolved_path.clone();
        Box::pin(async move { generate_codex_title(&content, &binary, path.as_str()).await })
    }

    /// `locateTranscript(sessionId)` — Codex resolves the rollout from its state DB
    /// via the thread registry, so `project_path`/`session_file_path` are unused.
    fn locate_transcript(
        &self,
        session_id: String,
        _project_path: String,
        _session_file_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<TranscriptLocation>, AdapterError>> {
        Box::pin(async move { Ok(locate_codex_transcript(&session_id, None).await) })
    }

    fn get_tool_categories(&self) -> Option<ToolCategories> {
        Some(ToolCategories {
            explore: HashSet::new(),
            // Codex todoList items — hidden from chat; Context tab TasksSection handles them.
            hidden: HashSet::from(["todo_list".to_string()]),
            // declared for parity; redundant once hidden filter fires.
            progress: HashSet::from(["todo_list".to_string()]),
            subagent: HashSet::from(["CollabAgent".to_string()]),
        })
    }

    fn configured_model(
        &self,
        project_path: String,
        executable_path: Option<String>,
    ) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move {
            crate::effective_model::probe(
                executable_path.as_deref().unwrap_or("codex"),
                self.resolved_path.as_str(),
                &project_path,
            )
            .await
        })
    }

    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession> {
        let session = Arc::new(CodexSession::new(
            options,
            None,
            self.resolved_path.clone(),
            Arc::clone(&self.background_tasks),
        ));
        let sessions = self.sessions.clone();
        let id = session.id().to_string();
        session.set_on_exit(Box::new(move || {
            sessions.lock_recover().retain(|s| s.id() != id);
        }));
        self.sessions.lock_recover().push(session.clone());
        session
    }

    fn kill_all(&self) {
        let drained: Vec<Arc<CodexSession>> = self.sessions.lock_recover().drain(..).collect();
        for session in drained {
            tokio::spawn(async move {
                if let Err(err) = session.kill().await {
                    tracing::warn!(error = %err, "failed to kill codex session during killAll");
                }
            });
        }
    }
}
