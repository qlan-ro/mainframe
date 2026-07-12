//! Ported from `packages/core/src/plugins/builtin/claude/external-session-cache.ts`.
//!
//! Process-lifetime metadata cache keyed by sessionId, validated by mtime+size.
//!
//! CONCURRENCY (CONCURRENCY.tsv → SHARED_MAP): the TS module-level singleton is
//! forbidden by rule 8. The cache is an injected `Arc<Mutex<HashMap<..>>>` owned
//! by the adapter; every accessor takes the handle. `new_external_session_cache`
//! constructs it at adapter init.

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

pub fn get_cached(
    cache: &ExternalSessionCache,
    session_id: &str,
    mtime_ms: f64,
    size: u64,
) -> Option<ExternalSession> {
    let map = cache.lock().ok()?;
    let e = map.get(session_id)?;
    if e.mtime_ms != mtime_ms || e.size != size {
        return None;
    }
    Some(e.meta.clone())
}

pub fn set_cached(
    cache: &ExternalSessionCache,
    session_id: &str,
    mtime_ms: f64,
    size: u64,
    meta: ExternalSession,
) {
    if let Ok(mut map) = cache.lock() {
        map.insert(
            session_id.to_string(),
            Entry {
                mtime_ms,
                size,
                meta,
            },
        );
    }
}

pub fn clear_external_session_cache(cache: &ExternalSessionCache) {
    if let Ok(mut map) = cache.lock() {
        map.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta() -> ExternalSession {
        ExternalSession {
            session_id: "a".to_string(),
            adapter_id: "claude".to_string(),
            project_path: "/p".to_string(),
            cwd: None,
            first_prompt: None,
            title: None,
            summary: None,
            message_count: None,
            created_at: "x".to_string(),
            modified_at: "x".to_string(),
            git_branch: None,
            model: None,
        }
    }

    #[test]
    fn returns_cached_meta_for_same_mtime_size() {
        let cache = new_external_session_cache();
        set_cached(&cache, "a", 100.0, 50, meta());
        assert_eq!(get_cached(&cache, "a", 100.0, 50), Some(meta()));
    }

    #[test]
    fn misses_when_mtime_changes() {
        let cache = new_external_session_cache();
        set_cached(&cache, "a", 100.0, 50, meta());
        assert_eq!(get_cached(&cache, "a", 200.0, 50), None);
    }

    #[test]
    fn misses_when_size_changes() {
        let cache = new_external_session_cache();
        set_cached(&cache, "a", 100.0, 50, meta());
        assert_eq!(get_cached(&cache, "a", 100.0, 99), None);
    }

    #[test]
    fn clear_empties_the_cache() {
        let cache = new_external_session_cache();
        set_cached(&cache, "a", 100.0, 50, meta());
        clear_external_session_cache(&cache);
        assert_eq!(get_cached(&cache, "a", 100.0, 50), None);
    }
}

// PORT STATUS: src/plugins/builtin/claude/external-session-cache.ts (24 lines)
// confidence: high
// todos: 0
// notes: SHARED_MAP per CONCURRENCY.tsv — the module-global Map is replaced by an
// injected Arc<Mutex<HashMap>>; get/set/clear take the handle (no module state,
// rule 8). Poisoned lock → miss/no-op (no unwrap). All 4 TS tests ported against
// a freshly-constructed cache handle (replacing the TS beforeEach(clear)).
