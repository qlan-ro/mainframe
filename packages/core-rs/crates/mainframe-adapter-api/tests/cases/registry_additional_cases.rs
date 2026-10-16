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

#[tokio::test]
async fn force_refresh_re_probes_an_adapter_past_its_successful_refresh() {
    let mut fa = FakeAdapter::new();
    fa.probe_result = Some(vec![model("live", "Live")]);
    let a = Arc::new(fa);
    let events = Arc::new(Mutex::new(Vec::new()));
    let reg = AdapterRegistry::new();
    reg.register(a.clone());
    reg.seed_static_snapshots();
    reg.configure_refresh(Arc::new(FakeDeps {
        resolve_path: Some("/abs/claude".into()),
        run_result: ok_run("claude 2.0.0"),
        events: events.clone(),
    }));
    reg.allow_refresh();
    reg.refresh_all().await;
    reg.refresh_all().await; // latched: no second probe
    assert_eq!(a.probe_count(), 1);

    reg.force_refresh("claude").await.unwrap();
    assert_eq!(a.probe_count(), 2);
    assert_eq!(reg.get_snapshots()[0].models_revision, Some(3));
    assert_eq!(events.lock().unwrap().len(), 2);
    // Unknown ids are a no-op.
    reg.force_refresh("nope").await.unwrap();
}
