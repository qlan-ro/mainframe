fn dual_history_session() -> mainframe_adapter_api::test_support::FakeSession {
    mainframe_adapter_api::test_support::FakeSession {
        session_id: Some("dual-sess".into()),
        adapter: Some("dual".into()),
        spawned: false,
        history: vec![text_msg(
            "m1",
            ChatMessageType::User,
            "please check @src/real.ts",
        )],
        scan_records: Some(vec![
            text_msg(
                "preamble",
                ChatMessageType::User,
                "<recommended_plugins>\n@qlan-ro/mainframe-ui\n</recommended_plugins>",
            ),
            tool_use_msg("m2", "tu1", "Bash", "gh pr create --title x"),
            tool_result_msg("m3", "tu1", "https://github.com/acme/repo/pull/9"),
        ]),
        ..mainframe_adapter_api::test_support::FakeSession::spawned()
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
    fn catalog(&self) -> Vec<mainframe_types::adapter::AdapterModel> {
        Vec::new()
    }
    fn create_session(&self, _options: SessionOptions) -> Arc<dyn AdapterSession> {
        Arc::new(dual_history_session())
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
