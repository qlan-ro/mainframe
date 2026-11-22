//! Account identity for quota keys (#268 F2).
//!
//! A concrete identity on a harvested quota is used as is. Without one, the
//! manager consults a per-adapter resolver through a short TTL cache, so a
//! burst of pushes does not hammer the trust-store read and a same-provider
//! account swap is still noticed within a minute.

use mainframe_types::sync::LockExt as _;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

/// Identity sentinel prefix meaning "read failed transiently": reuse the
/// last-known identity, never re-key.
const TRANSIENT_IDENTITY_PREFIX: &str = "transient:";
/// How long a resolved account identity is trusted before the resolver is
/// consulted again.
const IDENTITY_TTL_MS: i64 = 60_000;

/// Resolves the current logged-in account identity for one adapter (Claude
/// trust-store read, Codex quota-identity read). `None` means the resolver could
/// not produce a concrete identity right now (transient/absent) — reuse last-known.
pub type IdentityResolver =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = Option<String>> + Send>> + Send + Sync>;

pub(super) type SharedClock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// `raw` when it names an account; `None` when it is absent or the transient
/// sentinel.
pub(super) fn concrete_identity(raw: Option<&str>) -> Option<&str> {
    raw.filter(|identity| !identity.starts_with(TRANSIENT_IDENTITY_PREFIX))
}

struct CachedIdentity {
    identity: String,
    expires_at: i64,
}

pub(super) struct IdentityCache {
    resolvers: Mutex<HashMap<String, IdentityResolver>>,
    cached: Arc<Mutex<HashMap<String, CachedIdentity>>>,
    now: SharedClock,
}

impl IdentityCache {
    pub(super) fn new(now: SharedClock) -> Self {
        Self {
            resolvers: Mutex::new(HashMap::new()),
            cached: Arc::new(Mutex::new(HashMap::new())),
            now,
        }
    }

    pub(super) fn register(&self, adapter_id: &str, resolver: IdentityResolver) {
        self.resolvers
            .lock_recover()
            .insert(adapter_id.to_string(), resolver);
    }

    /// The cached identity for an adapter if it hasn't passed its TTL.
    pub(super) fn fresh(&self, adapter_id: &str) -> Option<String> {
        let now = (self.now)();
        self.cached
            .lock_recover()
            .get(adapter_id)
            .filter(|cached| cached.expires_at > now)
            .map(|cached| cached.identity.clone())
    }

    /// Fire-and-forget resolver read that refills the cache for the next push.
    /// A no-op without a runtime (sync-only tests) or a registered resolver.
    pub(super) fn warm_in_background(&self, adapter_id: &str) {
        if tokio::runtime::Handle::try_current().is_err() {
            return;
        }
        let Some(resolver) = self.resolver(adapter_id) else {
            return;
        };
        let cached = Arc::clone(&self.cached);
        let now = Arc::clone(&self.now);
        let adapter_id = adapter_id.to_string();
        tokio::spawn(async move {
            if let Some(identity) = resolver().await {
                store(&cached, adapter_id, identity, now());
            }
        });
    }

    /// Await the resolver and refill the cache (boot path). A transient or
    /// absent resolution returns `None` and leaves the cache untouched.
    pub(super) async fn refresh(&self, adapter_id: &str) -> Option<String> {
        let resolver = self.resolver(adapter_id)?;
        let identity = resolver().await?;
        store(
            &self.cached,
            adapter_id.to_string(),
            identity.clone(),
            (self.now)(),
        );
        Some(identity)
    }

    fn resolver(&self, adapter_id: &str) -> Option<IdentityResolver> {
        self.resolvers.lock_recover().get(adapter_id).cloned()
    }
}

fn store(
    cached: &Mutex<HashMap<String, CachedIdentity>>,
    adapter_id: String,
    identity: String,
    now: i64,
) {
    cached.lock_recover().insert(
        adapter_id,
        CachedIdentity {
            identity,
            expires_at: now + IDENTITY_TTL_MS,
        },
    );
}
