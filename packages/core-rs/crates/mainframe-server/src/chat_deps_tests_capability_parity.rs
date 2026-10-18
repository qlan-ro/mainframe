fn builtin_registry() -> AdapterRegistry {
    let registry = AdapterRegistry::new();
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let path = mainframe_runtime::ResolvedPath::from_value("/usr/bin");
    registry.register(Arc::new(
        mainframe_adapter_claude::adapter::ClaudeAdapter::new(
            tracker.clone(),
            Arc::new(ClaudeWorkflowStore::new()),
            path.clone(),
        ),
    ));
    registry.register(Arc::new(mainframe_adapter_codex::CodexAdapter::new(
        tracker, path,
    )));
    registry.register(Arc::new(mainframe_adapter_mock::MockCliAdapter::default()));
    registry
}

#[test]
fn external_session_ids_are_exactly_claude_and_codex() {
    let mut deps = test_deps();
    deps.adapters = Arc::new(builtin_registry());
    let mut ids = deps.external_session_adapter_ids();
    ids.sort();
    assert_eq!(ids, ["claude", "codex"]);
}

#[test]
fn daemon_decoders_match_base_bytes_on_full_and_incremental_paths() {
    use mainframe_display::{DisplayProjector, ProjectionInput, RawChange};
    let registry = builtin_registry();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../mainframe-display/tests/fixtures/display");
    for (provider, id) in [
        ("claude", "claude"),
        ("codex", "codex"),
        ("mock", "mock-cli"),
    ] {
        let raw: Vec<ChatMessage> = serde_json::from_slice(
            &std::fs::read(root.join(format!("{provider}.raw.json"))).unwrap(),
        )
        .unwrap();
        let cats = registry.get(id).unwrap().get_tool_categories();
        let decoders = super::adapters::decoder_set(&registry, id.into());
        let expected = std::fs::read(root.join(format!("{provider}.display.golden"))).unwrap();
        let full = mainframe_display::display_pipeline::prepare_messages_with_decoders(
            &raw,
            cats.as_ref(),
            decoders.as_ref(),
        );
        let bytes = |value: &[DisplayMessage]| {
            serde_json::to_vec_pretty(&serde_json::to_value(value).unwrap()).unwrap()
        };
        assert_eq!(bytes(&full), expected, "{provider} full");
        let mut projector =
            mainframe_display::incremental::IncrementalProjector::with_decoders(decoders);
        for end in 1..=raw.len() {
            let delta = projector.project(ProjectionInput {
                raw: &raw[..end],
                overlay: None,
                categories: cats.as_ref(),
                changes: [RawChange::Appended].into_iter().collect(),
            });
            if end == raw.len() {
                assert_eq!(
                    bytes(&delta.snapshot.materialize()),
                    expected,
                    "{provider} incremental"
                );
            }
        }
    }
}

#[test]
fn quota_registration_is_claude_merge_polled_and_codex_snapshot_once() {
    let mut sources: Vec<_> = crate::wiring::quota::quota_sources(&builtin_registry())
        .into_iter()
        .map(|source| (source.id, source.push_mode, source.poll))
        .collect();
    sources.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        sources,
        vec![
            ("claude".into(), IngestMode::Push, true),
            ("codex".into(), IngestMode::Snapshot, false)
        ]
    );
}
