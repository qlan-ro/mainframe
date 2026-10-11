use super::*;

impl Adapter for ClaudeAdapter {
    fn initial_transcript_path(&self, session_id: &str, cwd: &str) -> Option<String> {
        Some(get_session_jsonl_path(&encode_claude_project_path(session_id), cwd).jsonl_path)
    }

    fn relocate_transcript(
        &self,
        session: String,
        old_dir: String,
        new_dir: String,
    ) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        Box::pin(async move {
            use mainframe_runtime::session_files::{
                SessionFilesError, get_claude_project_dir, move_session_files,
            };
            let old = get_claude_project_dir(&old_dir);
            let new = get_claude_project_dir(&new_dir);
            move_session_files(&session, &old.to_string_lossy(), &new.to_string_lossy())
                .await
                .map_err(|SessionFilesError::Io(error)| AdapterError::Io(error))?;
            Ok(self.initial_transcript_path(&session, &new_dir))
        })
    }

    fn supports_external_sessions(&self) -> bool {
        true
    }
    fn list_external_sessions(
        &self,
        project: String,
        exclude: Vec<String>,
        offset: i64,
        limit: i64,
    ) -> BoxFuture<'_, mainframe_types::adapter::ExternalSessionPage> {
        Box::pin(async move {
            crate::external_sessions::list_external_sessions(
                &project,
                &exclude,
                Some(crate::external_sessions::ExternalSessionListOpts {
                    offset: Some(offset),
                    limit: Some(limit),
                }),
                &self.external_session_cache,
            )
            .await
        })
    }
    fn read_tool_result(&self, path: String, tool_id: String) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move {
            crate::messages::read_tool_result_from_jsonl::read_tool_result_from_jsonl(
                &path, &tool_id,
            )
            .await
        })
    }
    fn config_conflicts(&self) -> BoxFuture<'_, Vec<String>> {
        Box::pin(crate::config_conflicts::read())
    }

    fn quota_source(&self) -> Option<Arc<dyn mainframe_adapter_api::QuotaSource>> {
        Some(Arc::new(crate::quota_source::Source))
    }

    fn skills(&self) -> Option<Arc<dyn mainframe_adapter_api::SkillsProvider>> {
        Some(Arc::new(crate::skills_provider::Provider))
    }

    fn display_decoders(&self) -> Arc<dyn mainframe_display::ToolResultDecoders> {
        Arc::new(mainframe_display::decoders::MainframeDecoders)
    }

    fn id(&self) -> &str {
        "claude"
    }
    fn name(&self) -> &str {
        CLAUDE_ADAPTER_NAME
    }
    fn supports_steer(&self) -> bool {
        true
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities {
            plan_mode: true,
            auto_mode: true,
            // Verified interactively on 2.1.280 against Mainframe's stream-json spawn
            // (no --print): streaming, four turns, a permission gate and an interrupt
            // all work with --no-session-persistence, and no session JSONL is written.
            // See docs/research/adapters/claude/CONSUMED-SURFACE.md.
            no_persistence: true,
            // fork.rs implements pin_fork_point below.
            fork: true,
        }
    }

    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        let path = self.resolved_path.clone();
        Box::pin(async move {
            Ok(
                mainframe_adapter_api::version::version_stdout("claude", &path)
                    .await
                    .is_some(),
            )
        })
    }

    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        let path = self.resolved_path.clone();
        Box::pin(async move {
            let Some(stdout) =
                mainframe_adapter_api::version::version_stdout("claude", &path).await
            else {
                return Ok(None);
            };
            Ok(mainframe_adapter_api::version::CliVersion::parse(&stdout)
                .map(|v| v.to_string())
                .or_else(|| Some(stdout.trim().to_string())))
        })
    }

    fn catalog(&self) -> Vec<AdapterModel> {
        merged_catalog(
            self.dynamic_models.lock_recover().clone(),
            self.proxy_models.lock_recover().clone(),
        )
    }

    fn refresh_catalog(
        &self,
        executable_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<Vec<AdapterModel>>, AdapterError>> {
        let dynamic = self.dynamic_models.clone();
        let proxy = self.proxy_models.clone();
        let path = self.resolved_path.clone();
        Box::pin(async move {
            let exe = executable_path.unwrap_or_else(|| "claude".to_string());
            if let Some(result) = crate::probe_models::probe_models(&exe, path.as_str()).await {
                let enriched =
                    enrich_with_context_window(result.models, result.resolved_model.as_deref());
                *dynamic.lock_recover() = Some(merge_older_models(enriched));
            }
            *proxy.lock_recover() = crate::cliproxy::probe_catalog().await;

            let native = dynamic.lock_recover().clone();
            let proxy = proxy.lock_recover().clone();
            if native.is_none() && proxy.is_empty() {
                return Ok(None);
            }
            Ok(Some(merged_catalog(native, proxy)))
        })
    }

    fn configured_model(
        &self,
        project_path: String,
        executable_path: Option<String>,
    ) -> BoxFuture<'_, Option<String>> {
        Box::pin(async move {
            crate::effective_model::probe(
                executable_path.as_deref().unwrap_or("claude"),
                self.resolved_path.as_str(),
                &project_path,
            )
            .await
        })
    }

    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession> {
        let session = Arc::new(ClaudeSession::new(
            options,
            None,
            self.background_tasks.clone(),
            self.workflow_store.clone(),
            self.resolved_path.clone(),
        ));
        session.init_weak();
        let id = session.id.clone();
        let sessions = self.sessions.clone();
        session.set_on_exit(Box::new(move || {
            sessions.lock_recover().remove(&id);
        }));
        self.sessions
            .lock_recover()
            .insert(session.id.clone(), session.clone());
        session
    }

    fn kill_all(&self) {
        let all: Vec<Arc<ClaudeSession>> = self.sessions.lock_recover().values().cloned().collect();
        for session in all {
            tokio::spawn(async move {
                if let Err(err) = session.kill().await {
                    tracing::warn!(?err, "failed to kill claude session during killAll");
                }
            });
        }
        self.sessions.lock_recover().clear();
    }

    fn generate_title(
        &self,
        content: String,
        binary: String,
    ) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        let path = self.resolved_path.clone();
        Box::pin(async move { generate_claude_title(&content, &binary, path.as_str()).await })
    }

    fn locate_transcript(
        &self,
        session_id: String,
        project_path: String,
        session_file_path: Option<String>,
    ) -> BoxFuture<'_, Result<Option<TranscriptLocation>, AdapterError>> {
        Box::pin(async move {
            Ok(
                locate_claude_transcript(&session_id, &project_path, session_file_path.as_deref())
                    .await,
            )
        })
    }

    fn get_tool_categories(&self) -> Option<ToolCategories> {
        Some(ToolCategories {
            explore: tool_category(&["Read", "Glob", "Grep", "LS"]),
            hidden: tool_category(&[
                // TodoV1
                "TodoWrite",
                // TodoV2 (emitted as _TaskProgress)
                "TaskCreate",
                "TaskUpdate",
                "TaskList",
                "TaskGet",
                "TaskOutput",
                "TaskStop",
                // Mode/internal
                "EnterPlanMode",
                "AskUserQuestion",
                "ToolSearch",
            ]),
            progress: tool_category(&["TaskCreate", "TaskUpdate"]),
            subagent: tool_category(&["Task", "Agent"]),
        })
    }

    fn create_plan_mode_handler(&self) -> Option<Arc<dyn PlanModeActionHandler>> {
        Some(Arc::new(ClaudePlanModeHandler))
    }

    fn pin_fork_point(
        &self,
        request: mainframe_adapter_api::ForkPinRequest,
    ) -> BoxFuture<
        '_,
        Result<mainframe_types::adapter::ForkSource, mainframe_adapter_api::ForkPinError>,
    > {
        Box::pin(crate::fork::pin_fork_point(request))
    }
}
