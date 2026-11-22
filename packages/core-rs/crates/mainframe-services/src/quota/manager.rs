//! The daemon's in-memory quota state.
//!
//! Adapters push escalations (sparse merges) and registered pullers refresh full
//! snapshots; both are keyed per account so a same-provider swap lands on a fresh
//! bucket (#259). The current blob is persisted to the settings KV and reloaded
//! on boot. Status is always re-derived at read time so expiry reflects the real
//! clock.

use mainframe_types::sync::LockExt as _;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use mainframe_types::adapter::ProviderQuota;
use mainframe_types::events::DaemonEvent;
use mainframe_types::seam_error::SeamError;
use mainframe_types::settings_kv::SettingsKv;

use super::backoff::handle_pull_failure;
use super::identity::{IdentityCache, IdentityResolver, SharedClock, concrete_identity};
use super::keying::compute_quota_key;
use super::merge::{merge_provider_quota, replace_blob, to_sparse_update};
use super::persist::QuotaPersister;
use super::status::derive_provider_status;

pub(super) const QUOTA_CATEGORY: &str = "quota";

/// How a harvested quota folds in. `Pull` fully replaces; `Push` sparse-merges
/// (an omitted window keeps the prior value); `Snapshot` is a push that carries
/// the provider's whole window set, so it replaces like `Pull` while resolving
/// identity like `Push`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestMode {
    Pull,
    Push,
    Snapshot,
}

/// Harvests a fresh full-replacement blob for one adapter (e.g. Claude `/usage`).
pub type QuotaPuller = Arc<
    dyn Fn() -> Pin<Box<dyn Future<Output = Result<ProviderQuota, SeamError>> + Send>>
        + Send
        + Sync,
>;

type EmitFn = Box<dyn Fn(DaemonEvent) + Send + Sync>;
type ClockFn = Box<dyn Fn() -> i64 + Send + Sync>;

/// The read + manual-refresh surface the quota routes depend on. A trait (not the
/// concrete `QuotaManager`) so the route-unit harness can inject a fake.
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

/// Constructor collaborators for the quota manager.
pub struct QuotaManagerDeps {
    /// The account-wide settings store blobs persist into (`quota` category).
    pub settings: Arc<dyn SettingsKv>,
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

pub struct QuotaManager {
    state: Mutex<QuotaState>,
    pullers: Mutex<HashMap<String, (IngestMode, QuotaPuller)>>,
    push_modes: Mutex<HashMap<String, IngestMode>>,
    identities: IdentityCache,
    settings: Arc<dyn SettingsKv>,
    persister: QuotaPersister,
    emit_event: EmitFn,
    now: SharedClock,
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
            push_modes: Mutex::new(HashMap::new()),
            identities: IdentityCache::new(Arc::clone(&now)),
            persister: QuotaPersister::new(Arc::clone(&deps.settings)),
            settings: deps.settings,
            emit_event: deps.emit_event,
            now,
        }
    }

    /// Register an adapter's puller and how its pull result folds in.
    pub fn register_puller(&self, adapter_id: &str, mode: IngestMode, puller: QuotaPuller) {
        self.pullers
            .lock_recover()
            .insert(adapter_id.to_string(), (mode, puller));
    }

    /// How an adapter's session pushes fold in; unregistered adapters `Push`.
    pub fn register_push_mode(&self, adapter_id: &str, mode: IngestMode) {
        self.push_modes
            .lock_recover()
            .insert(adapter_id.to_string(), mode);
    }

    /// Fold a session-pushed quota in with the adapter's registered push mode.
    pub fn ingest_push(&self, adapter_id: &str, quota: ProviderQuota) -> ProviderQuota {
        let mode = self.push_modes.lock_recover().get(adapter_id).copied();
        self.ingest(adapter_id, quota, mode.unwrap_or(IngestMode::Push))
    }

    /// Register an adapter's account-identity resolver (#268 F2). Consulted through
    /// the TTL cache when a push arrives without a concrete identity, and at boot to
    /// select the right persisted blob for a swapped account.
    pub fn register_identity_resolver(&self, adapter_id: &str, resolver: IdentityResolver) {
        self.identities.register(adapter_id, resolver);
    }

    /// Rehydrate persisted blobs. The newest-observed per adapter is the default
    /// current one; when a registered resolver names a concrete identity with a
    /// persisted blob, that blob wins instead (#268 F2 boot selection). A store
    /// failure is logged and boots with no persisted quota.
    pub async fn load_from_disk(&self) {
        // Bind the persistence writer to the boot runtime rather than to
        // whichever runtime the first ingest happens to run on.
        self.persister.start_writer();
        let stored = match self.settings.get_by_category(QUOTA_CATEGORY).await {
            Ok(stored) => stored,
            Err(err) => {
                tracing::warn!(error = %err, category = QUOTA_CATEGORY, "failed to load persisted quota blobs");
                HashMap::new()
            }
        };
        let mut adapters: HashSet<String> = HashSet::new();
        {
            let mut st = self.state.lock_recover();
            for (key, value) in stored {
                let Some(blob) = safe_parse_quota(&value) else {
                    tracing::warn!(key = %key, "discarding unparseable persisted quota blob");
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
        let Some(identity) = self.identities.refresh(adapter_id).await else {
            return;
        };
        let key = compute_quota_key(adapter_id, Some(&identity));
        let mut st = self.state.lock_recover();
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
        let st = self.state.lock_recover();
        let blob = get_current_blob(&st, adapter_id)?;
        let mut out = blob.clone();
        out.status = derive_provider_status(blob, (self.now)());
        Some(out)
    }

    /// Fold a harvested quota into state per its `IngestMode`. Emits either way and queues the blob for persistence (written behind,
    /// in ingest order).
    pub fn ingest(
        &self,
        adapter_id: &str,
        quota: ProviderQuota,
        mode: IngestMode,
    ) -> ProviderQuota {
        let now = (self.now)();
        let (key, next) = {
            let mut st = self.state.lock_recover();
            let identity =
                self.resolve_identity(&st, adapter_id, quota.account_identity.as_deref(), mode);
            let key = compute_quota_key(adapter_id, identity.as_deref());
            let next = match mode {
                IngestMode::Pull | IngestMode::Snapshot => {
                    replace_blob(&quota, identity.clone(), now)
                }
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
        let entry = self.pullers.lock_recover().get(adapter_id).cloned();
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
            let mut st = self.state.lock_recover();
            let key = st.current_key.get(adapter_id)?.clone();
            let prior = st.blobs.get(&key)?.clone();
            let next = handle_pull_failure(Some(&prior), (self.now)());
            commit_state(
                &mut st,
                adapter_id,
                &key,
                prior.account_identity.as_deref(),
                &next,
            );
            (key, next)
        };
        self.persist_and_emit(adapter_id, &key, &next);
        Some(next)
    }

    /// The identity a harvested quota is keyed under. A concrete identity on
    /// the quota wins. Otherwise a pull reuses the last-known identity, while a
    /// push first consults the TTL cache and, on a miss, warms it out of band
    /// for the next push (`ingest` stays sync, so it never awaits the resolver).
    fn resolve_identity(
        &self,
        st: &QuotaState,
        adapter_id: &str,
        raw_identity: Option<&str>,
        mode: IngestMode,
    ) -> Option<String> {
        if let Some(identity) = concrete_identity(raw_identity) {
            return Some(identity.to_string());
        }
        if mode != IngestMode::Pull {
            if let Some(identity) = self.identities.fresh(adapter_id) {
                return Some(identity);
            }
            self.identities.warm_in_background(adapter_id);
        }
        st.last_known_identity.get(adapter_id).cloned()
    }

    /// Waits for every queued blob write to be attempted.
    #[cfg(test)]
    async fn flush_persistence(&self) {
        self.persister.flush().await;
    }

    fn persist_and_emit(&self, adapter_id: &str, key: &str, blob: &ProviderQuota) {
        match serde_json::to_string(blob) {
            Ok(value) => self.persister.persist(key, value),
            Err(err) => {
                tracing::error!(error = %err, key = %key, "failed to serialize quota blob for persistence")
            }
        }
        (self.emit_event)(DaemonEvent::ProviderQuotaUpdated {
            adapter_id: adapter_id.to_string(),
            quota: blob.clone(),
        });
    }
}

fn default_now() -> i64 {
    mainframe_types::time::now_ms()
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
    st.current_key
        .insert(adapter_id.to_string(), key.to_string());
    if let Some(identity) = concrete_identity(identity) {
        st.last_known_identity
            .insert(adapter_id.to_string(), identity.to_string());
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
#[path = "manager_tests.rs"]
mod tests;
