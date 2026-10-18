use super::*;
use mainframe_types::adapter::{ProviderQuotaStatus, QuotaWindow, QuotaWindowKind};
use mainframe_types::settings_kv::MemorySettings;
use std::sync::Mutex as StdMutex;

const NOW: i64 = 1_700_000_000_000;

fn session(used_percent: f64) -> QuotaWindow {
    QuotaWindow {
        kind: QuotaWindowKind::Session,
        used_percent,
        resets_at: Some(NOW + 3 * 60 * 60 * 1000),
        observed_at: Some(NOW),
        label: None,
    }
}

fn weekly(used_percent: f64) -> QuotaWindow {
    QuotaWindow {
        kind: QuotaWindowKind::Weekly,
        used_percent,
        resets_at: Some(NOW + 3 * 24 * 60 * 60 * 1000),
        observed_at: Some(NOW),
        label: None,
    }
}

fn claude_quota() -> ProviderQuota {
    ProviderQuota {
        status: ProviderQuotaStatus::Ok,
        observed_at: NOW,
        model_windows: vec![],
        session: Some(session(40.0)),
        weekly: None,
        account_identity: Some("uuid-1".into()),
    }
}

struct Ctx {
    manager: QuotaManager,
    events: Arc<StdMutex<Vec<DaemonEvent>>>,
    settings: Arc<MemorySettings>,
}

fn make_manager(settings: MemorySettings) -> Ctx {
    let settings = Arc::new(settings);
    let events = Arc::new(StdMutex::new(Vec::new()));
    let events_for_emit = Arc::clone(&events);
    let manager = QuotaManager::new(QuotaManagerDeps {
        settings: settings.clone(),
        emit_event: Box::new(move |e| events_for_emit.lock().unwrap().push(e)),
        now: Some(Box::new(|| NOW)),
    });
    Ctx {
        manager,
        events,
        settings,
    }
}

fn quota_of(event: &DaemonEvent) -> &ProviderQuota {
    match event {
        DaemonEvent::ProviderQuotaUpdated { quota, .. } => quota,
        _ => panic!("expected provider.quota.updated"),
    }
}

#[tokio::test]
async fn ingests_a_pull_persists_under_compound_key_and_emits() {
    let ctx = make_manager(MemorySettings::default());
    let result = ctx
        .manager
        .ingest("claude", claude_quota(), IngestMode::Pull);

    assert_eq!(result.status, ProviderQuotaStatus::Ok);
    assert_eq!(result.session.as_ref().unwrap().used_percent, 40.0);
    ctx.manager.flush_persistence().await;
    assert!(
        ctx.settings
            .get("quota", "claude:uuid-1")
            .await
            .unwrap()
            .is_some()
    );
    let events = ctx.events.lock().unwrap();
    assert_eq!(events.len(), 1);
    match &events[0] {
        DaemonEvent::ProviderQuotaUpdated { adapter_id, quota } => {
            assert_eq!(adapter_id, "claude");
            assert_eq!(quota.session.as_ref().unwrap().used_percent, 40.0);
        }
        _ => panic!("wrong event"),
    }
}

#[tokio::test]
async fn get_returns_current_blob_with_status_rederived() {
    let ctx = make_manager(MemorySettings::default());
    ctx.manager
        .ingest("claude", claude_quota(), IngestMode::Pull);
    let got = ctx.manager.get("claude").unwrap();
    assert_eq!(got.session.unwrap().used_percent, 40.0);
    assert_eq!(got.status, ProviderQuotaStatus::Ok);
}

#[tokio::test]
async fn push_sparse_merges_keeping_prior_weekly() {
    let ctx = make_manager(MemorySettings::default());
    ctx.manager.ingest(
        "claude",
        ProviderQuota {
            weekly: Some(weekly(10.0)),
            ..claude_quota()
        },
        IngestMode::Pull,
    );
    ctx.manager.ingest(
        "claude",
        ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            observed_at: NOW,
            model_windows: vec![],
            session: Some(session(80.0)),
            weekly: None,
            account_identity: Some("uuid-1".into()),
        },
        IngestMode::Push,
    );
    let got = ctx.manager.get("claude").unwrap();
    assert_eq!(got.session.unwrap().used_percent, 80.0);
    assert_eq!(got.weekly.unwrap().used_percent, 10.0);
}

#[tokio::test]
async fn reuses_last_known_identity_on_transient_push_sentinel() {
    let ctx = make_manager(MemorySettings::default());
    ctx.manager
        .ingest("claude", claude_quota(), IngestMode::Pull);
    ctx.manager.ingest(
        "claude",
        ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            observed_at: NOW,
            model_windows: vec![],
            session: Some(session(90.0)),
            weekly: None,
            account_identity: Some("transient:identity-read-failed".into()),
        },
        IngestMode::Push,
    );
    ctx.manager.flush_persistence().await;
    assert!(
        ctx.settings
            .get("quota", "claude:uuid-1")
            .await
            .unwrap()
            .is_some()
    );
    assert!(
        ctx.settings
            .get("quota", "claude:transient:identity-read-failed")
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        ctx.manager
            .get("claude")
            .unwrap()
            .session
            .unwrap()
            .used_percent,
        90.0
    );
}

#[tokio::test]
async fn account_swap_lands_on_fresh_key_with_no_inherited_windows() {
    let ctx = make_manager(MemorySettings::default());
    ctx.manager.ingest(
        "claude",
        ProviderQuota {
            weekly: Some(weekly(50.0)),
            ..claude_quota()
        },
        IngestMode::Pull,
    );
    ctx.manager.ingest(
        "claude",
        ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            observed_at: NOW,
            model_windows: vec![],
            session: Some(session(5.0)),
            weekly: None,
            account_identity: Some("uuid-2".into()),
        },
        IngestMode::Pull,
    );
    let got = ctx.manager.get("claude").unwrap();
    assert_eq!(got.session.unwrap().used_percent, 5.0);
    assert!(got.weekly.is_none());
    ctx.manager.flush_persistence().await;
    assert!(
        ctx.settings
            .get("quota", "claude:uuid-2")
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn load_from_disk_rehydrates_newest_observed_blob_per_adapter() {
    let settings = MemorySettings::default();
    settings
        .set(
            "quota",
            "claude:uuid-old",
            &serde_json::to_string(&ProviderQuota {
                observed_at: NOW - 10_000,
                session: Some(session(20.0)),
                ..claude_quota()
            })
            .unwrap(),
        )
        .await
        .unwrap();
    settings
        .set(
            "quota",
            "claude:uuid-new",
            &serde_json::to_string(&ProviderQuota {
                observed_at: NOW - 1_000,
                session: Some(session(70.0)),
                account_identity: Some("uuid-new".into()),
                ..claude_quota()
            })
            .unwrap(),
        )
        .await
        .unwrap();
    let ctx = make_manager(settings);
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
async fn load_from_disk_discards_unparseable_blob_without_panicking() {
    let settings = MemorySettings::default();
    settings
        .set("quota", "claude:uuid-1", "not-json")
        .await
        .unwrap();
    let ctx = make_manager(settings);
    ctx.manager.load_from_disk().await;
    assert!(ctx.manager.get("claude").is_none());
}

#[tokio::test]
async fn load_from_disk_boots_empty_when_the_store_fails() {
    let manager = QuotaManager::new(QuotaManagerDeps {
        settings: Arc::new(crate::settings::test_support::FailingSettings),
        emit_event: Box::new(|_| {}),
        now: Some(Box::new(|| NOW)),
    });
    manager.load_from_disk().await;
    assert!(manager.get("claude").is_none());
}
