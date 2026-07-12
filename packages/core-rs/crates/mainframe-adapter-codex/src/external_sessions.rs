//! Ported from `packages/core/src/plugins/builtin/codex/external-sessions.ts`.
//!
//! Discover importable Codex sessions by scanning the rollout JSONL files Codex
//! writes to `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<threadId>.jsonl`.
//! We scan the files directly (not Codex's state DB) so sessions started outside
//! Mainframe are found too — the same reason the Claude scanner reads `*.jsonl`
//! rather than trusting an index. A session belongs to a project when the `cwd`
//! recorded in its session_meta is the project root or nested under it.

use std::collections::{HashMap, HashSet};
use std::path::{MAIN_SEPARATOR, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::DateTime;
use mainframe_types::adapter::{ExternalSession, ExternalSessionPage};
use tokio::io::AsyncReadExt;

use crate::external_session_parse::{RolloutMeta, extract_meta, first_user_prompt, parse_lines};

const DEFAULT_LIMIT: usize = 50;
// Small read covers the session_meta line (cwd + git branch) for filtering and
// counting every candidate. Larger read reaches the first real user prompt,
// which sits past Codex's bundled preamble (~70KB in); only the enriched page
// window pays this cost.
const META_BYTES: u64 = 32 * 1024;
const PROMPT_BYTES: u64 = 192 * 1024;
const WALK_MAX_DEPTH: usize = 4; // sessions/YYYY/MM/DD/rollout-*.jsonl
const SYNTHETIC_TITLE: &str = "(session)";

/// Injectable scan deps — the sessions root the rollouts live under (for tests).
#[derive(Default)]
pub struct CodexScanDeps {
    pub sessions_root: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct Candidate {
    session_id: String,
    file_path: PathBuf,
    mtime_ms: f64,
    size: u64,
}

struct MatchedSession {
    meta: RolloutMeta,
    candidate: Candidate,
}

struct MetaCacheEntry {
    mtime_bits: u64,
    size: u64,
    meta: RolloutMeta,
}

struct PromptCacheEntry {
    mtime_bits: u64,
    size: u64,
    first_prompt: Option<String>,
}

static META_CACHE: OnceLock<Mutex<HashMap<String, MetaCacheEntry>>> = OnceLock::new();
static PROMPT_CACHE: OnceLock<Mutex<HashMap<String, PromptCacheEntry>>> = OnceLock::new();

fn meta_cache() -> &'static Mutex<HashMap<String, MetaCacheEntry>> {
    META_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prompt_cache() -> &'static Mutex<HashMap<String, PromptCacheEntry>> {
    PROMPT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn clear_codex_external_session_cache() {
    meta_cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    prompt_cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
}

pub fn codex_sessions_root() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".codex").join("sessions"))
        .unwrap_or_else(|| PathBuf::from(".codex").join("sessions"))
}

/// Belongs to this project if cwd equals the root or is nested under it.
fn cwd_belongs_to_project(cwd: Option<&str>, project_path: &str) -> bool {
    let Some(cwd) = cwd else {
        return false;
    };
    if cwd == project_path {
        return true;
    }
    cwd.starts_with(&format!("{project_path}{MAIN_SEPARATOR}"))
}

fn system_time_to_ms(t: Option<SystemTime>) -> f64 {
    match t.and_then(|t| t.duration_since(UNIX_EPOCH).ok()) {
        Some(d) => d.as_secs() as f64 * 1000.0 + f64::from(d.subsec_nanos()) / 1_000_000.0,
        None => 0.0,
    }
}

/// `^rollout-.*-(<uuid>)\.jsonl$` (case-insensitive) — the trailing 8-4-4-4-12 UUID.
/// Returns the id in its original case (the JS capture group), or `None`.
fn parse_rollout_uuid(name: &str) -> Option<String> {
    let chars: Vec<char> = name.chars().collect();
    let n = chars.len();
    if n < 6 {
        return None;
    }
    let suffix: String = chars[n - 6..].iter().collect();
    if !suffix.eq_ignore_ascii_case(".jsonl") {
        return None;
    }
    let base_len = n - 6;
    if base_len < 8 {
        return None;
    }
    let prefix: String = chars[..8].iter().collect();
    if !prefix.eq_ignore_ascii_case("rollout-") {
        return None;
    }
    if base_len < 37 {
        return None;
    }
    let uuid_start = base_len - 36;
    // The `-` before the UUID (from `.*-`) must sit past the `rollout-` prefix.
    if uuid_start < 9 || chars[uuid_start - 1] != '-' {
        return None;
    }
    let uuid: String = chars[uuid_start..base_len].iter().collect();
    if !is_uuid(&uuid) {
        return None;
    }
    Some(uuid)
}

fn is_uuid(s: &str) -> bool {
    let c: Vec<char> = s.chars().collect();
    if c.len() != 36 {
        return false;
    }
    let groups = [8usize, 4, 4, 4, 12];
    let mut idx = 0;
    for (gi, &g) in groups.iter().enumerate() {
        if gi > 0 {
            if c[idx] != '-' {
                return false;
            }
            idx += 1;
        }
        for _ in 0..g {
            if !c[idx].is_ascii_hexdigit() {
                return false;
            }
            idx += 1;
        }
    }
    idx == 36
}

fn walk_rollouts<'a>(
    dir: PathBuf,
    depth: usize,
    out: &'a mut Vec<Candidate>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    Box::pin(async move {
        // Expected: date dir vanished or root absent.
        let mut rd = match tokio::fs::read_dir(&dir).await {
            Ok(r) => r,
            Err(_) => return,
        };
        while let Ok(Some(entry)) = rd.next_entry().await {
            let full = entry.path();
            let ftype = match entry.file_type().await {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ftype.is_dir() {
                if depth < WALK_MAX_DEPTH {
                    walk_rollouts(full, depth + 1, out).await;
                }
                continue;
            }
            let name = entry.file_name();
            let Some(session_id) = parse_rollout_uuid(&name.to_string_lossy()) else {
                continue;
            };
            // Expected: file deleted mid-scan.
            if let Ok(st) = tokio::fs::metadata(&full).await {
                out.push(Candidate {
                    session_id,
                    file_path: full,
                    mtime_ms: system_time_to_ms(st.modified().ok()),
                    size: st.len(),
                });
            }
        }
    })
}

async fn read_head(file_path: &Path, bytes: u64) -> std::io::Result<String> {
    let mut file = tokio::fs::File::open(file_path).await?;
    let size = file.metadata().await?.len();
    let len = bytes.min(size) as usize;
    let mut buf = vec![0u8; len];
    file.read_exact(&mut buf).await?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

async fn load_meta(candidate: &Candidate) -> Option<RolloutMeta> {
    if let Some(hit) = {
        let cache = meta_cache().lock().unwrap_or_else(|e| e.into_inner());
        cache.get(&candidate.session_id).and_then(|c| {
            (c.mtime_bits == candidate.mtime_ms.to_bits() && c.size == candidate.size)
                .then(|| c.meta.clone())
        })
    } {
        return Some(hit);
    }

    let head = match read_head(&candidate.file_path, META_BYTES).await {
        Ok(h) => h,
        Err(err) => {
            tracing::warn!(
                module = "codex:external-sessions",
                err = %err,
                file_path = %candidate.file_path.display(),
                "failed to read rollout head"
            );
            return None;
        }
    };
    let meta = extract_meta(&parse_lines(&head), &head);
    meta_cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            candidate.session_id.clone(),
            MetaCacheEntry {
                mtime_bits: candidate.mtime_ms.to_bits(),
                size: candidate.size,
                meta: meta.clone(),
            },
        );
    Some(meta)
}

async fn load_first_prompt(candidate: &Candidate) -> Option<String> {
    if let Some(hit) = {
        let cache = prompt_cache().lock().unwrap_or_else(|e| e.into_inner());
        cache.get(&candidate.session_id).and_then(|c| {
            (c.mtime_bits == candidate.mtime_ms.to_bits() && c.size == candidate.size)
                .then(|| c.first_prompt.clone())
        })
    } {
        return hit;
    }

    let first_prompt = match read_head(&candidate.file_path, PROMPT_BYTES).await {
        Ok(h) => first_user_prompt(&parse_lines(&h)),
        Err(err) => {
            tracing::warn!(
                module = "codex:external-sessions",
                err = %err,
                file_path = %candidate.file_path.display(),
                "failed to read rollout prompt"
            );
            None
        }
    };
    prompt_cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            candidate.session_id.clone(),
            PromptCacheEntry {
                mtime_bits: candidate.mtime_ms.to_bits(),
                size: candidate.size,
                first_prompt: first_prompt.clone(),
            },
        );
    first_prompt
}

async fn collect_candidates(root: &Path, exclude: &HashSet<String>) -> Vec<Candidate> {
    let mut collected: Vec<Candidate> = Vec::new();
    walk_rollouts(root.to_path_buf(), 0, &mut collected).await;

    let mut by_session: HashMap<String, Candidate> = HashMap::new();
    for c in collected {
        if exclude.contains(&c.session_id) {
            continue;
        }
        let replace = match by_session.get(&c.session_id) {
            Some(prev) => c.mtime_ms > prev.mtime_ms,
            None => true,
        };
        if replace {
            by_session.insert(c.session_id.clone(), c);
        }
    }
    let mut vals: Vec<Candidate> = by_session.into_values().collect();
    vals.sort_by(|a, b| {
        b.mtime_ms
            .partial_cmp(&a.mtime_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.session_id.cmp(&a.session_id))
    });
    vals
}

/// `new Date(mtimeMs).toISOString()` (Date truncates fractional ms toward zero).
fn ms_to_iso(mtime_ms: f64) -> String {
    DateTime::from_timestamp_millis(mtime_ms.trunc() as i64)
        .map(mainframe_runtime::time::to_iso8601)
        .unwrap_or_default()
}

fn to_external_session(
    m: &MatchedSession,
    first_prompt: Option<String>,
    project_path: &str,
) -> ExternalSession {
    let modified_at = ms_to_iso(m.candidate.mtime_ms);
    ExternalSession {
        session_id: m.candidate.session_id.clone(),
        adapter_id: "codex".to_string(),
        project_path: project_path.to_string(),
        cwd: m.meta.cwd.clone(),
        first_prompt: first_prompt.clone(),
        title: Some(first_prompt.unwrap_or_else(|| SYNTHETIC_TITLE.to_string())),
        summary: None,
        message_count: None,
        created_at: m
            .meta
            .created_at
            .clone()
            .unwrap_or_else(|| modified_at.clone()),
        modified_at,
        git_branch: m.meta.git_branch.clone(),
        model: None,
    }
}

pub async fn list_external_sessions(
    project_path: &str,
    exclude_session_ids: &[String],
    offset: Option<usize>,
    limit: Option<usize>,
    deps: Option<&CodexScanDeps>,
) -> ExternalSessionPage {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(DEFAULT_LIMIT);
    let root = deps
        .and_then(|d| d.sessions_root.clone())
        .unwrap_or_else(codex_sessions_root);

    let exclude: HashSet<String> = exclude_session_ids.iter().cloned().collect();
    let candidates = collect_candidates(&root, &exclude).await;

    let mut matched: Vec<MatchedSession> = Vec::new();
    for candidate in &candidates {
        if let Some(meta) = load_meta(candidate).await
            && cwd_belongs_to_project(meta.cwd.as_deref(), project_path)
        {
            matched.push(MatchedSession {
                meta,
                candidate: candidate.clone(),
            });
        }
    }

    let total = matched.len() as i64;
    if limit == 0 {
        return ExternalSessionPage {
            sessions: Vec::new(),
            total,
            next_offset: None,
        };
    }

    let window: Vec<&MatchedSession> = matched.iter().skip(offset).take(limit).collect();
    let mut sessions: Vec<ExternalSession> = Vec::with_capacity(window.len());
    for m in &window {
        let prompt = load_first_prompt(&m.candidate).await;
        sessions.push(to_external_session(m, prompt, project_path));
    }
    let next_offset = if offset + limit < total as usize {
        Some((offset + limit) as i64)
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

    #[test]
    fn parses_rollout_filename_uuid() {
        let name = "rollout-2026-05-01T02-00-47-019de09f-93b4-7832-b2aa-c6b3dae20001.jsonl";
        assert_eq!(
            parse_rollout_uuid(name).as_deref(),
            Some("019de09f-93b4-7832-b2aa-c6b3dae20001")
        );
        assert_eq!(parse_rollout_uuid("notes.txt"), None);
        assert_eq!(parse_rollout_uuid("rollout-nope.jsonl"), None);
    }

    #[test]
    fn cwd_nesting() {
        assert!(cwd_belongs_to_project(Some("/a/b"), "/a/b"));
        assert!(cwd_belongs_to_project(Some("/a/b/c"), "/a/b"));
        assert!(!cwd_belongs_to_project(Some("/a/bc"), "/a/b"));
        assert!(!cwd_belongs_to_project(None, "/a/b"));
    }
}

// PORT STATUS: src/plugins/builtin/codex/external-sessions.ts (208 lines)
// confidence: high
// todos: 0
// notes: NEW (#430). metaCache/promptCache are module-global Map<sessionId,…> in TS →
// notes: static OnceLock<Mutex<HashMap>> here (brief non-await critical sections; the
// notes: guard is always dropped before any await — no await_holding_lock). mtimeMs is
// notes: f64 (Node fs mtimeMs); cache equality compares .to_bits() to avoid float_cmp.
// notes: ROLLOUT_RE is hand-rolled (parse_rollout_uuid + is_uuid) — no `regex` crate.
// notes: PERF(port): the SCAN_CONCURRENCY=8 bounded pool collapses to sequential awaits
// notes: (order + caching + results identical; only throughput differs). walk depth-4
// notes: recursion is a boxed future. read_head reads min(bytes,size) from offset 0.
// notes: New ExternalSession drops summary/messageCount/model (thread/list is gone).
// notes: external-sessions.test.ts (11 cases) ported in tests/external_sessions.rs.
