#[tokio::test]
async fn refresh_allowlist_keeps_other_adapters_on_static_catalogs() {
    let reg = AdapterRegistry::new();
    let real = Arc::new(FakeAdapter::new());
    let mut replay = FakeAdapter::new();
    replay.id = "mock-cli".into();
    let replay = Arc::new(replay);
    reg.register(real.clone());
    reg.register(replay.clone());
    reg.seed_static_snapshots();
    reg.configure_refresh(Arc::new(FakeDeps {
        resolve_path: None,
        run_result: ok_run("cli 2.0.0"),
        events: Arc::new(Mutex::new(Vec::new())),
    }));
    reg.allow_refresh_for(["mock-cli".into()]);
    reg.refresh_all().await;
    reg.list().await;
    assert_eq!(real.probe_count(), 0);
    assert!(replay.probe_count() > 0);
}
