//! Ported from `packages/core/src/plugins/builtin/claude/external-sessions.ts`.
//!
//! Lists importable external (Claude-native) sessions for a project: a stat-only
//! candidate scan across matching `~/.claude/projects` dirs, then bounded-
//! concurrency enrichment with a process-lifetime cache.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use mainframe_types::adapter::{ExternalSession, ExternalSessionPage};

use crate::external_session_cache::{ExternalSessionCache, get_cached, set_cached};
use crate::external_session_enrich::{Candidate, enrich_session};
use crate::external_session_paths::{
    canonicalize_project_path, discover_project_dirs, is_uuid_jsonl,
};

const DEFAULT_LIMIT: i64 = 50;
const ENRICH_CONCURRENCY: usize = 8;
const TITLE_GEN_PREFIX: &str = "Generate a short title (2-5 words) for a coding chat that";

#[derive(Debug, Clone, Copy, Default)]
pub struct ExternalSessionListOpts {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
}

/// Stat-only candidate pass: UUID-named jsonl across matching dirs, deduped +
/// sorted mtime desc.
pub async fn scan_lite_candidates(
    project_path: &str,
    exclude_set: &HashSet<String>,
) -> Vec<Candidate> {
    let canonical = canonicalize_project_path(project_path).await;
    let dirs = discover_project_dirs(&canonical).await;
    let mut by_session: HashMap<String, Candidate> = HashMap::new();

    for dir in dirs {
        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(e) => e,
            Err(_) => continue, // dir vanished between discovery and read
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_uuid_jsonl(&name) {
                continue;
            }
            let session_id = name[..name.len() - ".jsonl".len()].to_string();
            if exclude_set.contains(&session_id) {
                continue;
            }
            let file_path = Path::new(&dir).join(&name).to_string_lossy().to_string();
            let meta = match tokio::fs::metadata(&file_path).await {
                Ok(m) => m,
                Err(_) => continue, // file deleted mid-scan
            };
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            let size = meta.len();
            let better = match by_session.get(&session_id) {
                None => true,
                Some(prev) => mtime_ms > prev.mtime_ms,
            };
            if better {
                by_session.insert(
                    session_id.clone(),
                    Candidate {
                        session_id,
                        file_path,
                        mtime_ms,
                        size,
                    },
                );
            }
        }
    }

    let mut candidates: Vec<Candidate> = by_session.into_values().collect();
    // `b.mtimeMs - a.mtimeMs || (a.sessionId < b.sessionId ? 1 : -1)`
    candidates.sort_by(|a, b| {
        if b.mtime_ms != a.mtime_ms {
            b.mtime_ms
                .partial_cmp(&a.mtime_ms)
                .unwrap_or(Ordering::Equal)
        } else if a.session_id < b.session_id {
            Ordering::Greater
        } else {
            Ordering::Less
        }
    });
    candidates
}

/// Enrich a window with bounded concurrency, using the cache for unchanged files.
async fn enrich_window(
    window: Vec<Candidate>,
    project_path: &str,
    cache: &ExternalSessionCache,
) -> Vec<ExternalSession> {
    let len = window.len();
    let n = std::cmp::min(ENRICH_CONCURRENCY, len);
    let window = Arc::new(window);
    let out: Arc<Mutex<Vec<Option<ExternalSession>>>> = Arc::new(Mutex::new(vec![None; len]));
    let next = Arc::new(AtomicUsize::new(0));

    let mut handles = Vec::with_capacity(n);
    for _ in 0..n {
        let window = window.clone();
        let out = out.clone();
        let next = next.clone();
        let cache = cache.clone();
        let project_path = project_path.to_string();
        handles.push(tokio::spawn(async move {
            loop {
                let i = next.fetch_add(1, AtomicOrdering::SeqCst);
                if i >= window.len() {
                    return;
                }
                let c = &window[i];
                if let Some(cached) = get_cached(&cache, &c.session_id, c.mtime_ms, c.size) {
                    if let Ok(mut g) = out.lock() {
                        g[i] = Some(cached);
                    }
                    continue;
                }
                if let Some(meta) = enrich_session(c, &project_path).await {
                    set_cached(&cache, &c.session_id, c.mtime_ms, c.size, meta.clone());
                    if let Ok(mut g) = out.lock() {
                        g[i] = Some(meta);
                    }
                }
            }
        }));
    }
    for h in handles {
        let _ = h.await;
    }

    let results = out.lock().map(|g| g.clone()).unwrap_or_default();
    results
        .into_iter()
        .flatten()
        .filter(|s| !is_title_gen_ghost(s))
        .collect()
}

/// Belt-and-suspenders for pre-existing title-gen ghost files.
fn is_title_gen_ghost(s: &ExternalSession) -> bool {
    match &s.first_prompt {
        Some(fp) => !fp.is_empty() && fp.starts_with(TITLE_GEN_PREFIX),
        None => false,
    }
}

pub async fn list_external_sessions(
    project_path: &str,
    exclude_session_ids: &[String],
    opts: Option<ExternalSessionListOpts>,
    cache: &ExternalSessionCache,
) -> ExternalSessionPage {
    let offset = std::cmp::max(0, opts.and_then(|o| o.offset).unwrap_or(0));
    let limit = opts.and_then(|o| o.limit).unwrap_or(DEFAULT_LIMIT);

    // scan_lite_candidates is infallible here (all fallible steps are handled
    // internally), so the TS try/catch (`external-session lite scan failed`) is
    // unreachable in the port; kept as a note rather than a dead Result branch.
    let exclude_set: HashSet<String> = exclude_session_ids.iter().cloned().collect();
    let candidates = scan_lite_candidates(project_path, &exclude_set).await;

    let total = candidates.len() as i64;
    if limit <= 0 {
        return ExternalSessionPage {
            sessions: Vec::new(),
            total,
            next_offset: None,
        };
    }

    let start = (offset as usize).min(candidates.len());
    let end = ((offset + limit) as usize).min(candidates.len());
    let window: Vec<Candidate> = candidates[start..end].to_vec();
    let sessions = enrich_window(window, project_path, cache).await;
    let next_offset = if offset + limit < total {
        Some(offset + limit)
    } else {
        None
    };
    ExternalSessionPage {
        sessions,
        total,
        next_offset,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::external_session_cache::new_external_session_cache;

    #[tokio::test]
    async fn nonexistent_project_yields_empty_page() {
        let cache = new_external_session_cache();
        let page =
            list_external_sessions("/tmp/mainframe-does-not-exist-xyzzy-42", &[], None, &cache)
                .await;
        assert_eq!(page.total, 0);
        assert!(page.sessions.is_empty());
        assert_eq!(page.next_offset, None);
    }

    #[tokio::test]
    async fn limit_zero_returns_empty_sessions() {
        let cache = new_external_session_cache();
        let page = list_external_sessions(
            "/tmp/mainframe-does-not-exist-xyzzy-43",
            &[],
            Some(ExternalSessionListOpts {
                offset: None,
                limit: Some(0),
            }),
            &cache,
        )
        .await;
        assert!(page.sessions.is_empty());
        assert_eq!(page.next_offset, None);
    }
}

// PORT STATUS: src/plugins/builtin/claude/external-sessions.ts (105 lines)
// confidence: high
// todos: 0
// notes: getCached/setCached now take the injected cache (CONCURRENCY.tsv
// SHARED_MAP) so listExternalSessions/enrichWindow gained a `cache` param owned
// by the adapter. Bounded concurrency (ENRICH_CONCURRENCY=8) reproduced with a
// shared AtomicUsize cursor + N tokio tasks writing index-ordered slots (the
// `futures` crate is deferred/unavailable). The sort comparator matches
// `b.mtimeMs - a.mtimeMs || (a.sessionId < b.sessionId ? 1 : -1)`. mtimeMs from
// SystemTime → ms f64. scan_lite_candidates is infallible so the TS lite-scan
// try/catch is unreachable (noted). No TS __tests__ file — sanity tests cover the
// empty-project + limit<=0 paths.
