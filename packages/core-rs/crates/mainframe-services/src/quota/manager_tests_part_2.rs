#[tokio::test]
async fn refresh_invokes_registered_puller_and_ingests_result() {
    let ctx = make_manager(MemorySettings::default());
    let puller: QuotaPuller = Arc::new(|| {
        Box::pin(async {
            Ok(ProviderQuota {
                session: Some(session(33.0)),
                ..claude_quota()
            })
        })
    });
    ctx.manager
        .register_puller("claude", IngestMode::Pull, puller);
    let result = ctx.manager.refresh("claude").await;
    assert_eq!(result.unwrap().session.unwrap().used_percent, 33.0);
    assert_eq!(
        ctx.manager
            .get("claude")
            .unwrap()
            .session
            .unwrap()
            .used_percent,
        33.0
    );
}

#[tokio::test]
async fn refresh_keeps_last_known_blob_when_puller_throws() {
    let ctx = make_manager(MemorySettings::default());
    ctx.manager.ingest(
        "claude",
        ProviderQuota {
            session: Some(session(60.0)),
            ..claude_quota()
        },
        IngestMode::Pull,
    );
    let puller: QuotaPuller = Arc::new(|| Box::pin(async { Err(SeamError::msg("spawn failed")) }));
    ctx.manager
        .register_puller("claude", IngestMode::Pull, puller);
    let result = ctx.manager.refresh("claude").await;
    assert_eq!(result.unwrap().session.unwrap().used_percent, 60.0);
    assert_eq!(
        ctx.manager
            .get("claude")
            .unwrap()
            .session
            .unwrap()
            .used_percent,
        60.0
    );
}

#[tokio::test]
async fn refresh_on_adapter_without_puller_returns_last_known() {
    let ctx = make_manager(MemorySettings::default());
    ctx.manager.ingest(
        "codex",
        ProviderQuota {
            account_identity: Some("openai-1".into()),
            ..claude_quota()
        },
        IngestMode::Push,
    );
    let result = ctx.manager.refresh("codex").await;
    assert_eq!(result.unwrap().session.unwrap().used_percent, 40.0);
}

async fn persist(
    settings: &MemorySettings,
    key: &str,
    observed_at: i64,
    identity: &str,
    used: f64,
) {
    settings
        .set(
            "quota",
            key,
            &serde_json::to_string(&ProviderQuota {
                observed_at,
                session: Some(session(used)),
                account_identity: Some(identity.into()),
                ..claude_quota()
            })
            .unwrap(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn boot_resolver_selects_the_named_identitys_blob_over_newest_observed() {
    let settings = MemorySettings::default();
    persist(&settings, "claude:uuid-old", NOW - 10_000, "uuid-old", 20.0).await;
    persist(&settings, "claude:uuid-new", NOW - 1_000, "uuid-new", 70.0).await;
    let ctx = make_manager(settings);
    let resolver: IdentityResolver = Arc::new(|| Box::pin(async { Some("uuid-old".to_string()) }));
    ctx.manager.register_identity_resolver("claude", resolver);

    ctx.manager.load_from_disk().await;

    // Resolver names uuid-old, so its blob is current even though uuid-new is newer.
    assert_eq!(
        ctx.manager
            .get("claude")
            .unwrap()
            .session
            .unwrap()
            .used_percent,
        20.0
    );
}

#[tokio::test]
async fn boot_resolver_absent_keeps_the_newest_observed_blob() {
    let settings = MemorySettings::default();
    persist(&settings, "claude:uuid-old", NOW - 10_000, "uuid-old", 20.0).await;
    persist(&settings, "claude:uuid-new", NOW - 1_000, "uuid-new", 70.0).await;
    let ctx = make_manager(settings);
    let resolver: IdentityResolver = Arc::new(|| Box::pin(async { None }));
    ctx.manager.register_identity_resolver("claude", resolver);

    ctx.manager.load_from_disk().await;

    assert_eq!(
        ctx.manager
            .get("claude")
            .unwrap()
            .session
            .unwrap()
            .used_percent,
        70.0
    );
}

#[tokio::test]
async fn push_warms_the_identity_cache_so_the_next_push_keys_to_the_resolved_account() {
    let ctx = make_manager(MemorySettings::default());
    let resolver: IdentityResolver = Arc::new(|| Box::pin(async { Some("openai-42".to_string()) }));
    ctx.manager.register_identity_resolver("codex", resolver);

    // First identity-less push finds nothing cached; it warms the cache out-of-band.
    ctx.manager.ingest(
        "codex",
        ProviderQuota {
            account_identity: None,
            ..claude_quota()
        },
        IngestMode::Push,
    );
    // Let the spawned warm task fill the cache.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // The next identity-less push keys to the resolved account.
    ctx.manager.ingest(
        "codex",
        ProviderQuota {
            account_identity: None,
            session: Some(session(77.0)),
            ..claude_quota()
        },
        IngestMode::Push,
    );

    ctx.manager.flush_persistence().await;
    assert!(
        ctx.settings
            .get("quota", "codex:openai-42")
            .await
            .unwrap()
            .is_some()
    );
}

#[test]
fn quota_of_helper_reads_event_payload() {
    let event = DaemonEvent::ProviderQuotaUpdated {
        adapter_id: "claude".into(),
        quota: claude_quota(),
    };
    assert_eq!(
        quota_of(&event).session.as_ref().unwrap().used_percent,
        40.0
    );
}
