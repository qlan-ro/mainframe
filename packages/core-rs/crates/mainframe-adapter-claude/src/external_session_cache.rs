//! Process-lifetime metadata cache keyed by sessionId, validated by mtime+size.
//!
//! Concurrency: no module-level singleton. The cache is an injected
//! `Arc<Mutex<HashMap<..>>>` owned by the adapter; every accessor takes the
//! handle. `new_external_session_cache` constructs it at adapter init.

use mainframe_types::sync::LockExt;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mainframe_types::adapter::ExternalSession;

#[derive(Debug, Clone)]
pub struct Entry {
    pub mtime_ms: f64,
    pub size: u64,
    pub meta: ExternalSession,
}

pub type ExternalSessionCache = Arc<Mutex<HashMap<String, Entry>>>;

pub fn new_external_session_cache() -> ExternalSessionCache {
    Arc::new(Mutex::new(HashMap::new()))
}

pub(crate) fn get_cached(
    cache: &ExternalSessionCache,
    session_id: &str,
    mtime_ms: f64,
    size: u64,
) -> Option<ExternalSession> {
    let map = cache.lock_recover();
    let e = map.get(session_id)?;
    if e.mtime_ms != mtime_ms || e.size != size {
        return None;
    }
    Some(e.meta.clone())
}

pub(crate) fn set_cached(
    cache: &ExternalSessionCache,
    session_id: &str,
    mtime_ms: f64,
    size: u64,
    meta: ExternalSession,
) {
    cache.lock_recover().insert(
        session_id.to_string(),
        Entry {
            mtime_ms,
            size,
            meta,
        },
    );
}

#[cfg(test)]
pub(crate) fn clear_external_session_cache(cache: &ExternalSessionCache) {
    cache.lock_recover().clear();
}

#[cfg(test)]
#[path = "external_session_cache_tests.rs"]
mod tests;
