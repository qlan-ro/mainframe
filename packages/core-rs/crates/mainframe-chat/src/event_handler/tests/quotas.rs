use mainframe_services::quota::{QuotaManagerDeps, QuotaSettingsStore};
use mainframe_types::adapter::{ProviderQuotaStatus, QuotaWindow, QuotaWindowKind};
use std::collections::HashMap as StdHashMap;

const NOW: i64 = 1_700_000_000_000;

#[derive(Clone, Default)]
struct MapSettings {
    store: Arc<Mutex<StdHashMap<String, String>>>,
}
impl QuotaSettingsStore for MapSettings {
    fn get(&self, category: &str, key: &str) -> Option<String> {
        self.store
            .lock()
            .unwrap()
            .get(&format!("{category} {key}"))
            .cloned()
    }
    fn get_by_category(&self, category: &str) -> StdHashMap<String, String> {
        let mut out = StdHashMap::new();
        for (k, v) in self.store.lock().unwrap().iter() {
            if let Some((cat, key)) = k.split_once(' ')
                && cat == category
            {
                out.insert(key.to_string(), v.clone());
            }
        }
        out
    }
    fn set(&self, category: &str, key: &str, value: &str) {
        self.store
            .lock()
            .unwrap()
            .insert(format!("{category} {key}"), value.to_string());
    }
}

fn window(kind: QuotaWindowKind, used: f64) -> QuotaWindow {
    QuotaWindow {
        kind,
        used_percent: used,
        resets_at: Some(NOW + 3 * 60 * 60 * 1000),
        observed_at: Some(NOW),
        label: None,
    }
}
fn full(session: Option<QuotaWindow>, weekly: Option<QuotaWindow>) -> ProviderQuota {
    ProviderQuota {
        status: ProviderQuotaStatus::Ok,
        observed_at: NOW,
        model_windows: vec![],
        session,
        weekly,
        account_identity: Some("acct-1".into()),
    }
}

#[test]
fn sink_provider_quota_sparse_merges_into_the_quota_manager_and_fans_out() {
    let quota_events = Arc::new(Mutex::new(Vec::<DaemonEvent>::new()));
    let quota_events_emit = Arc::clone(&quota_events);
    let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings: Box::new(MapSettings::default()),
        emit_event: Box::new(move |e| quota_events_emit.lock().unwrap().push(e)),
        now: Some(Box::new(|| NOW)),
    }));

 // Seed a prior full blob (as a pull would) so the sparse push has a weekly
 // window to retain.
    quota.ingest(
        "codex",
        full(
            Some(window(QuotaWindowKind::Session, 20.0)),
            Some(window(QuotaWindowKind::Weekly, 55.0)),
        ),
        IngestMode::Pull,
    );

    let deps = FakeDeps::with_quota(cell(ProcessState::Working, None), Arc::clone(&quota));
    let handler = EventHandler::new(
        Arc::new(Mutex::new(MessageCache::new())),
        Arc::new(Mutex::new(PermissionManager::new())),
        deps,
    );
    let sink = handler.build_sink("c1", None);

 // The live session path: Codex pushes a session-only partial (weekly omitted).
    sink.on_provider_quota(
        "codex",
        full(Some(window(QuotaWindowKind::Session, 80.0)), None),
    );

    let merged = quota.get("codex").expect("quota persisted for codex");
    assert_eq!(merged.session.as_ref().unwrap().used_percent, 80.0);
    assert_eq!(
        merged.weekly.as_ref().unwrap().used_percent,
        55.0,
        "sparse Push retains the prior weekly window the partial omitted"
    );

    assert_quota_events(&quota_events.lock().unwrap());
}

fn assert_quota_events(events: &[DaemonEvent]) {
    assert_eq!(
        events.len(),
        2,
        "one fan-out for the seed pull, one for the push"
    );
    match &events[1] {
        DaemonEvent::ProviderQuotaUpdated { adapter_id, quota } => {
            assert_eq!(adapter_id, "codex");
            assert_eq!(quota.session.as_ref().unwrap().used_percent, 80.0);
            assert_eq!(quota.weekly.as_ref().unwrap().used_percent, 55.0);
        }
        other => panic!("expected provider.quota.updated, got {other:?}"),
    }
}
