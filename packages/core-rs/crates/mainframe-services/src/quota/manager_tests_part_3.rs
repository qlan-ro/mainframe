/// A Codex-shaped snapshot: weekly only, the plan's 5h window gone.
fn weekly_only_snapshot(identity: Option<&str>) -> ProviderQuota {
    ProviderQuota {
        status: ProviderQuotaStatus::Ok,
        observed_at: NOW,
        model_windows: vec![],
        session: None,
        weekly: Some(weekly(22.0)),
        account_identity: identity.map(str::to_string),
    }
}

fn session_and_weekly(identity: &str) -> ProviderQuota {
    ProviderQuota {
        session: Some(session(100.0)),
        weekly: Some(weekly(10.0)),
        account_identity: Some(identity.into()),
        ..claude_quota()
    }
}

#[tokio::test]
async fn snapshot_push_drops_a_window_the_provider_stopped_reporting() {
    let ctx = make_manager(MemorySettings::default());
    ctx.manager
        .ingest("codex", session_and_weekly("a@b.com"), IngestMode::Push);

    ctx.manager
        .ingest("codex", weekly_only_snapshot(None), IngestMode::Snapshot);

    let got = ctx.manager.get("codex").unwrap();
    assert!(
        got.session.is_none(),
        "the stuck 100% session window must go"
    );
    assert_eq!(got.weekly.unwrap().used_percent, 22.0);
    // Identity resolves like a push: the identity-less snapshot stays on the account.
    assert_eq!(got.account_identity.as_deref(), Some("a@b.com"));
}

#[tokio::test]
async fn ingest_push_folds_in_with_the_registered_push_mode() {
    let ctx = make_manager(MemorySettings::default());
    ctx.manager
        .register_push_mode("codex", IngestMode::Snapshot);
    ctx.manager
        .ingest("codex", session_and_weekly("a@b.com"), IngestMode::Push);
    ctx.manager
        .ingest("claude", session_and_weekly("uuid-1"), IngestMode::Pull);

    ctx.manager.ingest_push("codex", weekly_only_snapshot(None));
    ctx.manager
        .ingest_push("claude", weekly_only_snapshot(Some("uuid-1")));

    assert!(ctx.manager.get("codex").unwrap().session.is_none());
    // Unregistered adapters keep sparse-merging.
    assert_eq!(
        ctx.manager
            .get("claude")
            .unwrap()
            .session
            .unwrap()
            .used_percent,
        100.0
    );
}

#[tokio::test]
async fn pull_refresh_replaces_so_a_manual_refresh_clears_a_dropped_window() {
    let ctx = make_manager(MemorySettings::default());
    ctx.manager
        .ingest("codex", session_and_weekly("a@b.com"), IngestMode::Push);
    let puller: QuotaPuller =
        Arc::new(|| Box::pin(async { Ok(weekly_only_snapshot(Some("a@b.com"))) }));
    ctx.manager
        .register_puller("codex", IngestMode::Pull, puller);

    let got = ctx.manager.refresh("codex").await.unwrap();

    assert!(got.session.is_none());
    assert_eq!(got.weekly.unwrap().used_percent, 22.0);
}
