use super::*;
use mainframe_adapter_api::{Adapter, AdapterError, AdapterSession, BoxFuture, QuotaSource};
use mainframe_types::adapter::{AdapterCapabilities, ProviderQuota, SessionOptions};
use mainframe_types::settings_kv::{MemorySettings, SettingsKv};

struct IdentityAdapter(&'static str);
impl Adapter for IdentityAdapter {
    fn id(&self) -> &str {
        self.0
    }
    fn name(&self) -> &str {
        self.0
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: false,
            fork: false,
        }
    }
    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(false) })
    }
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        Box::pin(async { Ok(None) })
    }
    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession> {
        mainframe_adapter_mock::MockCliAdapter::default().create_session(options)
    }
    fn kill_all(&self) {}
    fn quota_source(&self) -> Option<Arc<dyn QuotaSource>> {
        Some(Arc::new(OldIdentity))
    }
}
struct OldIdentity;
impl QuotaSource for OldIdentity {
    fn identity(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async { Some("old".into()) })
    }
    fn pull(&self, _: String, _: String) -> BoxFuture<'_, Result<ProviderQuota, AdapterError>> {
        Box::pin(async { Err(AdapterError::Message("must not pull at boot".into())) })
    }
}

#[tokio::test]
async fn bootstrap_selects_resolved_identity_before_loading_persisted_quota() {
    let settings = Arc::new(MemorySettings::default());
    let adapters = AdapterRegistry::new();
    for id in ["claude", "codex"] {
        adapters.register(Arc::new(IdentityAdapter(id)));
        for (identity, observed) in [("old", 100), ("new", 200)] {
            let blob = serde_json::json!({"status":"ok", "modelWindows":[], "observedAt":observed, "accountIdentity":identity});
            settings
                .set("quota", &format!("{id}:{identity}"), &blob.to_string())
                .await
                .unwrap();
        }
    }
    let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings,
        now: Some(Box::new(|| 300)),
        emit_event: Box::new(|_| {}),
    }));
    let db = Db::spawn(|| mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")))
        .unwrap();
    initialize_quota(
        &quota,
        &adapters,
        &db,
        &mainframe_runtime::ResolvedPath::from_value("/usr/bin"),
    )
    .await;
    for id in ["claude", "codex"] {
        assert_eq!(
            quota.get(id).unwrap().account_identity.as_deref(),
            Some("old")
        );
    }
}
