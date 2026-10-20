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

struct DualAdapter {
    loads: Arc<std::sync::atomic::AtomicUsize>,
}

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
        Arc::new(mainframe_adapter_api::test_support::FakeSession {
            history_loads: Some(self.loads.clone()),
            ..dual_history_session()
        })
    }
    fn kill_all(&self) {}
}

fn create_dual_chat(deps: &DaemonChatDeps) -> Chat {
    let project = deps
        .db
        .call_blocking(|d| d.projects.create("/tmp/p1", None))
        .unwrap();
    let chat = deps
        .db
        .call_blocking(move |d| {
            d.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id,
                adapter_id: "dual".into(),
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
                        vendor_session_id: Some("sess-1".into()),
                        ..Default::default()
                    },
                )
            }
        })
        .unwrap();
    chat
}

async fn assert_history_sources(reuse_canonical: bool) {
    let deps = test_deps();
    let loads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    deps.adapters.register(Arc::new(DualAdapter {
        loads: loads.clone(),
    }));
    let chat = create_dual_chat(&deps);
    let canonical = dual_history_session().history;
    AdapterPort::scan_loaded_history(
        &deps,
        &chat.id,
        reuse_canonical.then_some(canonical.as_slice()),
    )
    .await;
    assert_eq!(
        loads.load(std::sync::atomic::Ordering::SeqCst),
        usize::from(!reuse_canonical)
    );
    assert_scanned_links(&deps, &chat.id);
}

fn assert_scanned_links(deps: &DaemonChatDeps, chat_id: &str) {
    let mentions = deps
        .db
        .call_blocking({
            let id = chat_id.to_owned();
            move |d| d.chats.get_mentions(&id)
        })
        .unwrap();
    assert_eq!(
        mentions
            .iter()
            .map(|m| m.path.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("src/real.ts")]
    );
    let prs = deps
        .db
        .call_blocking({
            let id = chat_id.to_owned();
            move |d| d.chats.get_detected_prs(&id)
        })
        .unwrap();
    assert_eq!(
        prs,
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/9".into(),
            owner: "acme".into(),
            repo: "repo".into(),
            number: 9,
            source: DetectedPrSource::Created,
        }]
    );
}

#[tokio::test]
async fn scans_canonical_mentions_and_distinct_pr_records_without_reloading_supplied_history() {
    assert_history_sources(true).await;
}

#[tokio::test]
async fn loads_canonical_history_when_a_composed_or_failed_load_cannot_supply_it() {
    assert_history_sources(false).await;
}
