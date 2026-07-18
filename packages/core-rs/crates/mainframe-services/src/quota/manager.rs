//! Ported from `src/quota/manager.ts` — the daemon's in-memory quota state.
//!
//! Adapters push escalations (sparse merges) and registered pullers refresh full
//! snapshots; both are keyed per account so a same-provider swap lands on a fresh
//! bucket (#259). The current blob is persisted to the settings KV and reloaded
//! on boot. Status is always re-derived at read time so expiry reflects the real
//! clock.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};

use mainframe_types::adapter::{ProviderQuota, ProviderQuotaStatus};
use mainframe_types::events::DaemonEvent;

use super::backoff::handle_pull_failure;
use super::keying::{compute_quota_key, resolve_account_identity};
use super::merge::{merge_provider_quota, ProviderQuotaUpdate};
use super::status::derive_provider_status;

const QUOTA_CATEGORY: &str = "quota";
/// Identity sentinel prefix meaning "read failed transiently" — reuse last-known,
/// never re-key.
const TRANSIENT_IDENTITY_PREFIX: &str = "transient:";
/// How long a resolved account identity is trusted before the resolver is
/// re-consulted (#268 F2). Short enough to catch a same-provider swap promptly,
/// long enough that a burst of pushes doesn't hammer the trust-store read.
const IDENTITY_TTL_MS: i64 = 60_000;

/// Whether a harvested quota fully replaces (`Pull`) or sparse-merges (`Push`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestMode {
    Pull,
    Push,
}

/// The account-wide `settings` KV surface the manager persists into. Sync, to
/// mirror the TS `settings` collaborator (better-sqlite3 is synchronous); the
/// daemon backs it with the `Db` actor's blocking bridge.
pub trait QuotaSettingsStore: Send + Sync {
    fn get(&self, category: &str, key: &str) -> Option<String>;
    fn get_by_category(&self, category: &str) -> HashMap<String, String>;
    fn set(&self, category: &str, key: &str, value: &str);
}

/// Harvests a fresh full-replacement blob for one adapter (e.g. Claude `/usage`).
pub type QuotaPuller = Arc<
    dyn Fn() -> Pin<Box<dyn Future<Output = Result<ProviderQuota, String>> + Send>> + Send + Sync,
>;

/// Resolves the current logged-in account identity for one adapter (Claude
/// trust-store read, Codex quota-identity read). `None` means the resolver could
/// not produce a concrete identity right now (transient/absent) — reuse last-known.
pub type IdentityResolver = Arc<
    dyn Fn() -> Pin<Box<dyn Future<Output = Option<String>> + Send>> + Send + Sync,
>;

type EmitFn = Box<dyn Fn(DaemonEvent) + Send + Sync>;
type ClockFn = Box<dyn Fn() -> i64 + Send + Sync>;
type SharedClock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// The read + manual-refresh surface the quota routes depend on. A trait (not the
/// concrete `QuotaManager`) so the route-unit harness can inject a fake, mirroring
/// the duck-typed `{ get, refresh }` the TS route accepts.
pub trait QuotaService: Send + Sync {
    fn get(&self, adapter_id: &str) -> Option<ProviderQuota>;
    fn refresh<'a>(
        &'a self,
        adapter_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<ProviderQuota>> + Send + 'a>>;
}

impl QuotaService for QuotaManager {
    fn get(&self, adapter_id: &str) -> Option<ProviderQuota> {
        QuotaManager::get(self, adapter_id)
    }

    fn refresh<'a>(
        &'a self,
        adapter_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<ProviderQuota>> + Send + 'a>> {
        Box::pin(QuotaManager::refresh(self, adapter_id))
    }
}

/// Constructor collaborators, mirroring `QuotaManagerDeps`.
pub struct QuotaManagerDeps {
    pub settings: Box<dyn QuotaSettingsStore>,
    pub emit_event: EmitFn,
    /// Injected clock; defaults to wall-clock epoch-ms when `None`.
    pub now: Option<ClockFn>,
}

#[derive(Default)]
struct QuotaState {
    blobs: HashMap<String, ProviderQuota>,
    current_key: HashMap<String, String>,
    last_known_identity: HashMap<String, String>,
}

/// A resolved identity trusted until `expires_at` (#268 F2 TTL cache).
#[derive(Clone)]
struct CachedIdentity {
    identity: String,
    expires_at: i64,
}

pub struct QuotaManager {
    state: Mutex<QuotaState>,
    pullers: Mutex<HashMap<String, (IngestMode, QuotaPuller)>>,
    identity_resolvers: Mutex<HashMap<String, IdentityResolver>>,
    identity_cache: Arc<Mutex<HashMap<String, CachedIdentity>>>,
    settings: Box<dyn QuotaSettingsStore>,
    emit_event: EmitFn,
    now: SharedClock,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl QuotaManager {
    #[must_use]
    pub fn new(deps: QuotaManagerDeps) -> Self {
        let now: SharedClock = deps
            .now
            .map_or_else(|| Arc::new(default_now) as SharedClock, Arc::from);
        Self {
            state: Mutex::new(QuotaState::default()),
            pullers: Mutex::new(HashMap::new()),
            identity_resolvers: Mutex::new(HashMap::new()),
            identity_cache: Arc::new(Mutex::new(HashMap::new())),
            settings: deps.settings,
            emit_event: deps.emit_event,
            now,
        }
    }

    /// Register an adapter's puller and how its pull result folds in: Claude
    /// `/usage` is a full snapshot (`Pull`/replace); Codex reads the app-server
    /// sparsely, so its pull merges like a push (#268 F5).
    pub fn register_puller(&self, adapter_id: &str, mode: IngestMode, puller: QuotaPuller) {
        lock(&self.pullers).insert(adapter_id.to_string(), (mode, puller));
    }

    /// Register an adapter's account-identity resolver (#268 F2). Consulted through
    /// the TTL cache when a push arrives without a concrete identity, and at boot to
    /// select the right persisted blob for a swapped account.
    pub fn register_identity_resolver(&self, adapter_id: &str, resolver: IdentityResolver) {
        lock(&self.identity_resolvers)
            .insert(adapter_id.to_string(), resolver);
    }

    /// Rehydrate persisted blobs. The newest-observed per adapter is the default
    /// current one; when a registered resolver names a concrete identity with a
    /// persisted blob, that blob wins instead (#268 F2 boot selection).
    pub async fn load_from_disk(&self) {
        let stored = self.settings.get_by_category(QUOTA_CATEGORY);
        let mut adapters: HashSet<String> = HashSet::new();
        {
            let mut st = lock(&self.state);
            for (key, value) in stored {
                let Some(blob) = safe_parse_quota(&value) else {
                    tracing::warn!(key = %key, "quota: discarding unparseable persisted blob");
                    continue;
                };
                st.blobs.insert(key.clone(), blob.clone());
                let Some(adapter_id) = adapter_id_from_key(&key) else {
                    continue;
                };
                adapters.insert(adapter_id.to_string());
                let is_newer = match get_current_blob(&st, adapter_id) {
                    Some(current) => blob.observed_at > current.observed_at,
                    None => true,
                };
                if is_newer {
                    let adapter_id = adapter_id.to_string();
                    st.current_key.insert(adapter_id.clone(), key.clone());
                    if let Some(identity) = &blob.account_identity {
                        st.last_known_identity.insert(adapter_id, identity.clone());
                    }
                }
            }
        }
        for adapter_id in adapters {
            self.apply_boot_identity(&adapter_id).await;
        }
    }

    /// If a resolver names a concrete identity whose blob is persisted, make it the
    /// current blob (overriding the newest-observed fallback). A transient/absent
    /// resolution leaves the fallback in place.
    async fn apply_boot_identity(&self, adapter_id: &str) {
        let Some(identity) = self.refresh_cached_identity(adapter_id).await else {
            return;
        };
        let key = compute_quota_key(adapter_id, Some(&identity));
        let mut st = lock(&self.state);
        if st.blobs.contains_key(&key) {
            st.current_key.insert(adapter_id.to_string(), key);
            st.last_known_identity
                .insert(adapter_id.to_string(), identity);
        }
    }

    /// The current blob for an adapter, with status re-derived at the present
    /// instant.
    #[must_use]
    pub fn get(&self, adapter_id: &str) -> Option<ProviderQuota> {
        let st = lock(&self.state);
        let blob = get_current_blob(&st, adapter_id)?;
        let mut out = blob.clone();
        out.status = derive_provider_status(blob, (self.now)());
        Some(out)
    }

    /// Fold a harvested quota into state. `Pull` fully replaces the account's
    /// blob; `Push` sparse-merges (an omitted window keeps the prior value).
    /// Persists and emits either way.
    pub fn ingest(&self, adapter_id: &str, quota: ProviderQuota, mode: IngestMode) -> ProviderQuota {
        let now = (self.now)();
        let (key, next) = {
            let mut st = lock(&self.state);
            let identity = match mode {
                IngestMode::Pull => {
                    self.resolve_identity(&st, adapter_id, quota.account_identity.as_deref())
                }
                IngestMode::Push => {
                    self.resolve_push_identity(&st, adapter_id, quota.account_identity.as_deref())
                }
            };
            let key = compute_quota_key(adapter_id, identity.as_deref());
            let next = match mode {
                IngestMode::Pull => replace_blob(&quota, identity.clone(), now),
                IngestMode::Push => merge_provider_quota(
                    st.blobs.get(&key),
                    to_sparse_update(&quota, identity.clone()),
                    now,
                ),
            };
            commit_state(&mut st, adapter_id, &key, identity.as_deref(), &next);
            (key, next)
        };
        self.persist_and_emit(adapter_id, &key, &next);
        next
    }

    /// Puller-driven refresh. On failure keep the last-known blob (backoff); no
    /// puller ⇒ last-known.
    pub async fn refresh(&self, adapter_id: &str) -> Option<ProviderQuota> {
        let entry = lock(&self.pullers).get(adapter_id).cloned();
        let Some((mode, puller)) = entry else {
            return self.get(adapter_id);
        };
        match puller().await {
            Ok(quota) => Some(self.ingest(adapter_id, quota, mode)),
            Err(err) => {
                tracing::warn!(error = %err, adapter_id = %adapter_id, "quota pull failed; keeping last-known");
                self.reevaluate(adapter_id)
            }
        }
    }

    /// Re-derive status on the current blob (post-failure / expiry) and
    /// re-persist + emit.
    fn reevaluate(&self, adapter_id: &str) -> Option<ProviderQuota> {
        let (key, next) = {
            let mut st = lock(&self.state);
            let key = st.current_key.get(adapter_id)?.clone();
            let prior = st.blobs.get(&key)?.clone();
            let next = handle_pull_failure(Some(&prior), (self.now)());
            commit_state(&mut st, adapter_id, &key, prior.account_identity.as_deref(), &next);
            (key, next)
        };
        self.persist_and_emit(adapter_id, &key, &next);
        Some(next)
    }

    fn resolve_identity(
        &self,
        st: &QuotaState,
        adapter_id: &str,
        raw_identity: Option<&str>,
    ) -> Option<String> {
        let is_transient = raw_identity.is_none_or(|r| r.starts_with(TRANSIENT_IDENTITY_PREFIX));
        if is_transient {
            resolve_account_identity(None, st.last_known_identity.get(adapter_id).map(String::as_str))
        } else {
            raw_identity.map(str::to_string)
        }
    }

    /// Identity for a push (#268 F2). A concrete identity on the push wins outright.
    /// Otherwise consult the TTL cache; on a cache miss warm it out-of-band for the
    /// next push and fall back to last-known for this one (`ingest` stays sync, so we
    /// never block on the resolver here).
    fn resolve_push_identity(
        &self,
        st: &QuotaState,
        adapter_id: &str,
        raw_identity: Option<&str>,
    ) -> Option<String> {
        if let Some(raw) = raw_identity
            && !raw.starts_with(TRANSIENT_IDENTITY_PREFIX)
        {
            return Some(raw.to_string());
        }
        if let Some(identity) = self.fresh_cached_identity(adapter_id) {
            return Some(identity);
        }
        self.spawn_identity_warm(adapter_id);
        resolve_account_identity(None, st.last_known_identity.get(adapter_id).map(String::as_str))
    }

    /// The cached identity for an adapter if it hasn't passed its TTL.
    fn fresh_cached_identity(&self, adapter_id: &str) -> Option<String> {
        let now = (self.now)();
        lock(&self.identity_cache)
            .get(adapter_id)
            .filter(|cached| cached.expires_at > now)
            .map(|cached| cached.identity.clone())
    }

    /// Fire-and-forget resolver read that refills the TTL cache for the next push.
    /// A no-op without a runtime (sync-only tests) or a registered resolver.
    fn spawn_identity_warm(&self, adapter_id: &str) {
        if tokio::runtime::Handle::try_current().is_err() {
            return;
        }
        let Some(resolver) = lock(&self.identity_resolvers).get(adapter_id).cloned() else {
            return;
        };
        let cache = Arc::clone(&self.identity_cache);
        let now = Arc::clone(&self.now);
        let adapter_id = adapter_id.to_string();
        tokio::spawn(async move {
            if let Some(identity) = resolver().await {
                lock(&cache).insert(
                    adapter_id,
                    CachedIdentity {
                        identity,
                        expires_at: (now)() + IDENTITY_TTL_MS,
                    },
                );
            }
        });
    }

    /// Await the resolver and refill the TTL cache (boot path). `None` on a
    /// transient/absent resolution leaves the cache untouched.
    async fn refresh_cached_identity(&self, adapter_id: &str) -> Option<String> {
        let resolver = lock(&self.identity_resolvers).get(adapter_id).cloned()?;
        let identity = resolver().await?;
        lock(&self.identity_cache).insert(
            adapter_id.to_string(),
            CachedIdentity {
                identity: identity.clone(),
                expires_at: (self.now)() + IDENTITY_TTL_MS,
            },
        );
        Some(identity)
    }

    fn persist_and_emit(&self, adapter_id: &str, key: &str, blob: &ProviderQuota) {
        match serde_json::to_string(blob) {
            Ok(value) => self.settings.set(QUOTA_CATEGORY, key, &value),
            Err(err) => tracing::error!(%err, key = %key, "quota: failed to serialize blob for persistence"),
        }
        (self.emit_event)(DaemonEvent::ProviderQuotaUpdated {
            adapter_id: adapter_id.to_string(),
            quota: blob.clone(),
        });
    }
}

fn default_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

fn get_current_blob<'a>(st: &'a QuotaState, adapter_id: &str) -> Option<&'a ProviderQuota> {
    let key = st.current_key.get(adapter_id)?;
    st.blobs.get(key)
}

fn commit_state(
    st: &mut QuotaState,
    adapter_id: &str,
    key: &str,
    identity: Option<&str>,
    blob: &ProviderQuota,
) {
    st.blobs.insert(key.to_string(), blob.clone());
    st.current_key.insert(adapter_id.to_string(), key.to_string());
    if let Some(identity) = identity
        && !identity.starts_with(TRANSIENT_IDENTITY_PREFIX)
    {
        st.last_known_identity
            .insert(adapter_id.to_string(), identity.to_string());
    }
}

/// A full-replacement pull: take exactly the harvested windows, re-deriving status.
fn replace_blob(quota: &ProviderQuota, identity: Option<String>, now: i64) -> ProviderQuota {
    let mut blob = ProviderQuota {
        status: ProviderQuotaStatus::Unknown,
        session: quota.session.clone(),
        weekly: quota.weekly.clone(),
        model_windows: quota.model_windows.clone(),
        observed_at: quota.observed_at,
        account_identity: identity,
    };
    blob.status = derive_provider_status(&blob, now);
    blob
}

/// An empty `model_windows` is dropped so a push can't clear the prior model windows.
fn to_sparse_update(quota: &ProviderQuota, identity: Option<String>) -> ProviderQuotaUpdate {
    ProviderQuotaUpdate {
        observed_at: quota.observed_at,
        account_identity: identity,
        session: quota.session.clone(),
        weekly: quota.weekly.clone(),
        model_windows: if quota.model_windows.is_empty() {
            None
        } else {
            Some(quota.model_windows.clone())
        },
    }
}

/// The adapterId is the key segment before the first colon (`claude`/`codex` carry none).
fn adapter_id_from_key(key: &str) -> Option<&str> {
    match key.find(':') {
        Some(idx) if idx > 0 => Some(&key[..idx]),
        _ => None,
    }
}

fn safe_parse_quota(value: &str) -> Option<ProviderQuota> {
    // serde enforces `observedAt: i64` + `modelWindows: Vec` presence, so a
    // malformed or partial blob fails to deserialize (caller logs and skips).
    serde_json::from_str(value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::adapter::{QuotaWindow, QuotaWindowKind};
    use std::sync::Mutex as StdMutex;

    const NOW: i64 = 1_700_000_000_000;

    #[derive(Clone, Default)]
    struct MapSettings {
        store: Arc<StdMutex<HashMap<String, String>>>,
    }

    impl QuotaSettingsStore for MapSettings {
        fn get(&self, category: &str, key: &str) -> Option<String> {
            self.store.lock().unwrap().get(&format!("{category} {key}")).cloned()
        }
        fn get_by_category(&self, category: &str) -> HashMap<String, String> {
            let mut out = HashMap::new();
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
        settings: MapSettings,
    }

    fn make_manager(settings: MapSettings) -> Ctx {
        let events = Arc::new(StdMutex::new(Vec::new()));
        let events_for_emit = Arc::clone(&events);
        let manager = QuotaManager::new(QuotaManagerDeps {
            settings: Box::new(settings.clone()),
            emit_event: Box::new(move |e| events_for_emit.lock().unwrap().push(e)),
            now: Some(Box::new(|| NOW)),
        });
        Ctx { manager, events, settings }
    }

    fn quota_of(event: &DaemonEvent) -> &ProviderQuota {
        match event {
            DaemonEvent::ProviderQuotaUpdated { quota, .. } => quota,
            _ => panic!("expected provider.quota.updated"),
        }
    }

    #[tokio::test]
    async fn ingests_a_pull_persists_under_compound_key_and_emits() {
        let ctx = make_manager(MapSettings::default());
        let result = ctx.manager.ingest("claude", claude_quota(), IngestMode::Pull);

        assert_eq!(result.status, ProviderQuotaStatus::Ok);
        assert_eq!(result.session.as_ref().unwrap().used_percent, 40.0);
        assert!(ctx.settings.get("quota", "claude:uuid-1").is_some());
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
        let ctx = make_manager(MapSettings::default());
        ctx.manager.ingest("claude", claude_quota(), IngestMode::Pull);
        let got = ctx.manager.get("claude").unwrap();
        assert_eq!(got.session.unwrap().used_percent, 40.0);
        assert_eq!(got.status, ProviderQuotaStatus::Ok);
    }

    #[tokio::test]
    async fn push_sparse_merges_keeping_prior_weekly() {
        let ctx = make_manager(MapSettings::default());
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
        let ctx = make_manager(MapSettings::default());
        ctx.manager.ingest("claude", claude_quota(), IngestMode::Pull);
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
        assert!(ctx.settings.get("quota", "claude:uuid-1").is_some());
        assert!(ctx
            .settings
            .get("quota", "claude:transient:identity-read-failed")
            .is_none());
        assert_eq!(ctx.manager.get("claude").unwrap().session.unwrap().used_percent, 90.0);
    }

    #[tokio::test]
    async fn account_swap_lands_on_fresh_key_with_no_inherited_windows() {
        let ctx = make_manager(MapSettings::default());
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
        assert!(ctx.settings.get("quota", "claude:uuid-2").is_some());
    }

    #[tokio::test]
    async fn load_from_disk_rehydrates_newest_observed_blob_per_adapter() {
        let settings = MapSettings::default();
        settings.set(
            "quota",
            "claude:uuid-old",
            &serde_json::to_string(&ProviderQuota {
                observed_at: NOW - 10_000,
                session: Some(session(20.0)),
                ..claude_quota()
            })
            .unwrap(),
        );
        settings.set(
            "quota",
            "claude:uuid-new",
            &serde_json::to_string(&ProviderQuota {
                observed_at: NOW - 1_000,
                session: Some(session(70.0)),
                account_identity: Some("uuid-new".into()),
                ..claude_quota()
            })
            .unwrap(),
        );
        let ctx = make_manager(settings);
        ctx.manager.load_from_disk().await;
        assert_eq!(ctx.manager.get("claude").unwrap().session.unwrap().used_percent, 70.0);
    }

    #[tokio::test]
    async fn load_from_disk_discards_unparseable_blob_without_panicking() {
        let settings = MapSettings::default();
        settings.set("quota", "claude:uuid-1", "not-json");
        let ctx = make_manager(settings);
        ctx.manager.load_from_disk().await;
        assert!(ctx.manager.get("claude").is_none());
    }

    #[tokio::test]
    async fn refresh_invokes_registered_puller_and_ingests_result() {
        let ctx = make_manager(MapSettings::default());
        let puller: QuotaPuller = Arc::new(|| {
            Box::pin(async {
                Ok(ProviderQuota {
                    session: Some(session(33.0)),
                    ..claude_quota()
                })
            })
        });
        ctx.manager.register_puller("claude", IngestMode::Pull, puller);
        let result = ctx.manager.refresh("claude").await;
        assert_eq!(result.unwrap().session.unwrap().used_percent, 33.0);
        assert_eq!(ctx.manager.get("claude").unwrap().session.unwrap().used_percent, 33.0);
    }

    #[tokio::test]
    async fn refresh_keeps_last_known_blob_when_puller_throws() {
        let ctx = make_manager(MapSettings::default());
        ctx.manager.ingest(
            "claude",
            ProviderQuota {
                session: Some(session(60.0)),
                ..claude_quota()
            },
            IngestMode::Pull,
        );
        let puller: QuotaPuller =
            Arc::new(|| Box::pin(async { Err("spawn failed".to_string()) }));
        ctx.manager.register_puller("claude", IngestMode::Pull, puller);
        let result = ctx.manager.refresh("claude").await;
        assert_eq!(result.unwrap().session.unwrap().used_percent, 60.0);
        assert_eq!(ctx.manager.get("claude").unwrap().session.unwrap().used_percent, 60.0);
    }

    #[tokio::test]
    async fn refresh_on_adapter_without_puller_returns_last_known() {
        let ctx = make_manager(MapSettings::default());
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

    fn persist(settings: &MapSettings, key: &str, observed_at: i64, identity: &str, used: f64) {
        settings.set(
            "quota",
            key,
            &serde_json::to_string(&ProviderQuota {
                observed_at,
                session: Some(session(used)),
                account_identity: Some(identity.into()),
                ..claude_quota()
            })
            .unwrap(),
        );
    }

    #[tokio::test]
    async fn boot_resolver_selects_the_named_identitys_blob_over_newest_observed() {
        let settings = MapSettings::default();
        persist(&settings, "claude:uuid-old", NOW - 10_000, "uuid-old", 20.0);
        persist(&settings, "claude:uuid-new", NOW - 1_000, "uuid-new", 70.0);
        let ctx = make_manager(settings);
        let resolver: IdentityResolver = Arc::new(|| Box::pin(async { Some("uuid-old".to_string()) }));
        ctx.manager.register_identity_resolver("claude", resolver);

        ctx.manager.load_from_disk().await;

        // Resolver names uuid-old, so its blob is current even though uuid-new is newer.
        assert_eq!(ctx.manager.get("claude").unwrap().session.unwrap().used_percent, 20.0);
    }

    #[tokio::test]
    async fn boot_resolver_absent_keeps_the_newest_observed_blob() {
        let settings = MapSettings::default();
        persist(&settings, "claude:uuid-old", NOW - 10_000, "uuid-old", 20.0);
        persist(&settings, "claude:uuid-new", NOW - 1_000, "uuid-new", 70.0);
        let ctx = make_manager(settings);
        let resolver: IdentityResolver = Arc::new(|| Box::pin(async { None }));
        ctx.manager.register_identity_resolver("claude", resolver);

        ctx.manager.load_from_disk().await;

        assert_eq!(ctx.manager.get("claude").unwrap().session.unwrap().used_percent, 70.0);
    }

    #[tokio::test]
    async fn push_warms_the_identity_cache_so_the_next_push_keys_to_the_resolved_account() {
        let ctx = make_manager(MapSettings::default());
        let resolver: IdentityResolver =
            Arc::new(|| Box::pin(async { Some("openai-42".to_string()) }));
        ctx.manager.register_identity_resolver("codex", resolver);

        // First identity-less push finds nothing cached; it warms the cache out-of-band.
        ctx.manager.ingest(
            "codex",
            ProviderQuota { account_identity: None, ..claude_quota() },
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

        assert!(ctx.settings.get("quota", "codex:openai-42").is_some());
    }

    #[test]
    fn quota_of_helper_reads_event_payload() {
        let event = DaemonEvent::ProviderQuotaUpdated {
            adapter_id: "claude".into(),
            quota: claude_quota(),
        };
        assert_eq!(quota_of(&event).session.as_ref().unwrap().used_percent, 40.0);
    }
}
