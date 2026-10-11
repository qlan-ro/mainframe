/// Codex-shaped session: `load_history` is the plain `thread/read` replay
/// (one real `@`-mention, no PR tool output); `load_scan_records` is the
/// rollout reconstruction, carrying both the PR-create tool pair `load_history`
/// lacks (codex-cli 0.147.0 never returns `commandExecution` from
/// `thread/read`) and an injected preamble record shaped like the rollout's
/// `<recommended_plugins>` wrapper, which reads as a bogus `@`-mention if
/// scanned.
struct DualHistorySession;

impl AdapterSession for DualHistorySession {
    fn id(&self) -> &str {
        "dual-sess"
    }
    fn adapter_id(&self) -> &str {
        "dual"
    }
    fn project_path(&self) -> &str {
        "/tmp"
    }
    fn is_spawned(&self) -> bool {
        false
    }
    fn spawn(
        &self,
        _options: Option<SessionSpawnOptions>,
        _sink: Option<Arc<dyn SessionSink>>,
    ) -> BoxFuture<'_, Result<AdapterProcess, AdapterError>> {
        Box::pin(async { Err(AdapterError::Message("unused".to_string())) })
    }
    fn kill(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn get_process_info(&self) -> Option<AdapterProcess> {
        None
    }
    fn send_message(
        &self,
        _message: String,
        _images: Vec<ImageInput>,
        _uuid: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn respond_to_permission(
        &self,
        _response: ControlResponse,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn interrupt(&self) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn set_model(&self, _model: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn set_permission_mode(
        &self,
        _mode: mainframe_types::settings::ExecutionMode,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn set_plan_mode(&self, _on: bool) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn send_command(
        &self,
        _command: String,
        _args: Option<String>,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
    fn cancel_queued_message(&self, _uuid: String) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(false) })
    }
    fn get_context_files(&self) -> ContextFiles {
        ContextFiles {
            global: Vec::new(),
            project: Vec::new(),
        }
    }
    fn load_history(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin(async {
            Ok(vec![text_msg(
                "m1",
                ChatMessageType::User,
                "please check @src/real.ts",
            )])
        })
    }
    fn load_scan_records(&self) -> BoxFuture<'_, Result<Vec<ChatMessage>, AdapterError>> {
        Box::pin(async {
            Ok(vec![
                text_msg(
                    "preamble",
                    ChatMessageType::User,
                    "<recommended_plugins>\n@qlan-ro/mainframe-ui\n</recommended_plugins>",
                ),
                tool_use_msg("m2", "tu1", "Bash", "gh pr create --title x"),
                tool_result_msg("m3", "tu1", "https://github.com/acme/repo/pull/9"),
            ])
        })
    }
    fn extract_plan_files(&self) -> BoxFuture<'_, Result<Vec<String>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn extract_skill_files(&self) -> BoxFuture<'_, Result<Vec<SkillFileEntry>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn stop_background_task(
        &self,
        _task_id: String,
    ) -> BoxFuture<'_, Result<mainframe_adapter_api::StopBackgroundTaskResult, AdapterError>> {
        Box::pin(async {
            Ok(mainframe_adapter_api::StopBackgroundTaskResult {
                ok: false,
                error: Some("unsupported".to_string()),
            })
        })
    }
}

struct DualAdapter;

impl mainframe_adapter_api::Adapter for DualAdapter {
    fn id(&self) -> &str {
        "dual"
    }
    fn name(&self) -> &str {
        "Dual"
    }
    fn capabilities(&self) -> mainframe_types::adapter::AdapterCapabilities {
        mainframe_types::adapter::AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: false,
            fork: false,
        }
    }
    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(true) })
    }
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        Box::pin(async { Ok(None) })
    }
    fn list_models(
        &self,
    ) -> BoxFuture<'_, Result<Vec<mainframe_types::adapter::AdapterModel>, AdapterError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn create_session(&self, _options: SessionOptions) -> Arc<dyn AdapterSession> {
        Arc::new(DualHistorySession)
    }
    fn kill_all(&self) {}
}

/// Cold-load @-mention scanning must stay pinned to `load_history` even
/// when the PR scan needs `load_scan_records`'s wider reconstruction —
/// otherwise Codex's injected rollout preamble leaks in as a bogus file
/// mention.
#[tokio::test]
async fn scan_loaded_history_scans_mentions_from_load_history_and_prs_from_load_scan_records() {
    let deps = test_deps();
    deps.adapters.register(Arc::new(DualAdapter));
    let project = deps
        .db
        .call_blocking(|d| d.projects.create("/tmp/p1", None))
        .unwrap();
    let chat = deps
        .db
        .call_blocking(move |d| {
            d.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id.clone(),
                adapter_id: "dual".to_string(),
                ..Default::default()
            })
        })
        .unwrap();
    deps.db
        .call_blocking({
            let id = chat.id.clone();
            move |d| {
                d.chats.update(
                    &id,
                    &ChatPatch {
                        vendor_session_id: Some("sess-1".to_string()),
                        ..Default::default()
                    },
                )
            }
        })
        .unwrap();

    AdapterPort::scan_loaded_history(&deps, &chat.id).await;

    let mentions = deps
        .db
        .call_blocking({
            let id = chat.id.clone();
            move |d| d.chats.get_mentions(&id)
        })
        .unwrap();
    assert_eq!(
        mentions
            .iter()
            .map(|m| m.path.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("src/real.ts")],
        "mention scan must read load_history only, not the load_scan_records preamble"
    );

    let prs = deps
        .db
        .call_blocking({
            let id = chat.id.clone();
            move |d| d.chats.get_detected_prs(&id)
        })
        .unwrap();
    assert_eq!(
        prs,
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/9".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 9,
            source: DetectedPrSource::Created,
        }],
        "PR scan must still read load_scan_records, where the Codex tool pair lives"
    );
}
