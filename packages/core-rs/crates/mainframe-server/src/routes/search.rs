//! Ported from `src/server/routes/search.ts`.
//!
//! One endpoint: project content search. Ripgrep-first for directories (with a
//! JS walk fallback that re-validates every enumerated file for symlink
//! containment), a direct read for a single-file scope. Every path is realpath'd
//! and confirmed inside the (realpath'd) project base before it is read.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::extract::{Path as AxPath, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use mainframe_types::search::SearchContentResult;

use crate::ctx::AppCtx;
use crate::fs_utils::{has_binary_extension, list_project_files, relative};
use crate::path_utils::is_within_base;
use crate::respond::{fail, ok};
use crate::ripgrep::{RipgrepOptions, is_ripgrep_available, search_with_ripgrep};
use crate::routes::files::resolve_base;

const MAX_RESULTS: usize = 200;
const MAX_FILES_SCANNED: usize = 5000;
const MAX_FILE_SIZE: u64 = 1024 * 1024; // 1MB
const MAX_LINE_LENGTH: usize = 500;

fn qget<'a>(q: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    q.get(key).map(String::as_str)
}

/// `realpath(base)` + `realpath(resolve(base, target))` then containment.
/// `None` when either path does not exist or the target escapes the base.
async fn resolve_within_base(base: &str, target: &str) -> Option<String> {
    let real_base = tokio::fs::canonicalize(base).await.ok()?;
    let real_target = tokio::fs::canonicalize(Path::new(base).join(target))
        .await
        .ok()?;
    is_within_base(&real_base, &real_target).then(|| real_target.to_string_lossy().into_owned())
}

fn is_binary_buffer(buf: &[u8]) -> bool {
    buf.iter().take(512).any(|&b| b == 0)
}

/// Search one file's lines for `query` (case-insensitive), appending
/// `{file,line,column,text}` matches (line-length-capped) up to `max`.
async fn search_file(
    file_path: &str,
    rel_path: &str,
    query: &str,
    results: &mut Vec<SearchContentResult>,
    max: usize,
) {
    let bytes = match tokio::fs::read(file_path).await {
        Ok(b) => b,
        Err(err) => {
            tracing::warn!(error = %err, file_path, "Failed to read file during content search");
            return;
        }
    };
    if is_binary_buffer(&bytes) {
        return;
    }
    let content = String::from_utf8_lossy(&bytes);
    let lower_query: Vec<char> = query.to_lowercase().chars().collect();

    for (i, line) in content.split('\n').enumerate() {
        if results.len() >= max {
            break;
        }
        let truncated: String = line.chars().take(MAX_LINE_LENGTH).collect();
        let lower_line: Vec<char> = truncated.to_lowercase().chars().collect();
        let mut from = 0;
        while results.len() < max {
            match char_index_of(&lower_line, &lower_query, from) {
                Some(col) => {
                    results.push(SearchContentResult {
                        file: rel_path.to_string(),
                        line: (i + 1) as i64,
                        column: (col + 1) as i64,
                        text: truncated.clone(),
                    });
                    from = col + 1;
                }
                None => break,
            }
        }
    }
}

/// First index (in `char` units) of `needle` in `haystack` at or after `from`.
fn char_index_of(haystack: &[char], needle: &[char], from: usize) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    (from..=haystack.len() - needle.len()).find(|&i| haystack[i..i + needle.len()] == *needle)
}

/// GET /api/projects/:id/search/content
async fn content_search(
    State(ctx): State<Arc<AppCtx>>,
    AxPath(id): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let (query, scope_path) = match validate_query(&q) {
        Ok(v) => v,
        Err(msg) => return fail(StatusCode::BAD_REQUEST, msg),
    };
    let include_ignored = qget(&q, "includeIgnored") == Some("true");

    let raw_base = match resolve_base(&ctx, &id, qget(&q, "chatId")).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    let base = match tokio::fs::canonicalize(&raw_base).await {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(err) => {
            tracing::warn!(error = %err, raw_base, "Project base path not resolvable");
            return fail(StatusCode::NOT_FOUND, "Project not found");
        }
    };

    let Some(resolved_scope) = resolve_within_base(&base, scope_path).await else {
        return fail(StatusCode::FORBIDDEN, "Path outside project");
    };
    let scope_meta = match tokio::fs::metadata(&resolved_scope).await {
        Ok(m) => m,
        Err(err) => {
            tracing::warn!(error = %err, resolved_scope, "Scope path not found during content search");
            return fail(StatusCode::NOT_FOUND, "Path not found");
        }
    };

    let mut results: Vec<SearchContentResult> = Vec::new();
    if !scope_meta.is_dir() {
        search_single_file(&base, &resolved_scope, query, &mut results).await;
    } else {
        search_directory(&base, &resolved_scope, query, include_ignored, &mut results).await;
    }

    ok(serde_json::json!({ "results": results }))
}

/// `ContentSearchQuery`: `q` min 2 (custom msg), `path` min 1 (custom msg).
fn validate_query(q: &HashMap<String, String>) -> Result<(&str, &str), String> {
    let query = qget(q, "q");
    let path = qget(q, "path");
    let mut issues: Vec<&str> = Vec::new();
    match query {
        None => issues.push("Required"),
        Some(s) if s.chars().count() < 2 => issues.push("Query must be at least 2 characters"),
        _ => {}
    }
    match path {
        None => issues.push("Required"),
        Some("") => issues.push("path is required"),
        _ => {}
    }
    if !issues.is_empty() {
        return Err(issues.join(", "));
    }
    Ok((query.unwrap_or_default(), path.unwrap_or_default()))
}

async fn search_single_file(
    base: &str,
    resolved_scope: &str,
    query: &str,
    results: &mut Vec<SearchContentResult>,
) {
    match tokio::fs::metadata(resolved_scope).await {
        Ok(meta) if meta.len() <= MAX_FILE_SIZE => {
            let rel = relative(Path::new(base), Path::new(resolved_scope));
            search_file(resolved_scope, &rel, query, results, MAX_RESULTS).await;
        }
        Ok(_) => {}
        Err(err) => {
            tracing::warn!(error = %err, resolved_scope, "Failed to stat file for content search");
        }
    }
}

async fn search_directory(
    base: &str,
    resolved_scope: &str,
    query: &str,
    include_ignored: bool,
    results: &mut Vec<SearchContentResult>,
) {
    let rg_results = search_with_ripgrep(
        resolved_scope,
        query,
        &RipgrepOptions {
            max_results: Some(MAX_RESULTS),
            max_file_size: Some("1M".to_string()),
            include_ignored,
        },
    )
    .await;

    if !rg_results.is_empty() || is_ripgrep_available() {
        for r in rg_results {
            let abs_file = Path::new(resolved_scope).join(&r.file);
            let rel_file = relative(Path::new(base), &abs_file);
            if has_binary_extension(&rel_file) {
                continue;
            }
            results.push(SearchContentResult {
                file: rel_file,
                ..r
            });
        }
    } else {
        search_directory_fallback(base, resolved_scope, query, include_ignored, results).await;
    }
}

/// JS fallback: enumerate project files, filter to the scope subtree, and search
/// each after re-validating symlink containment (an in-repo symlink that escapes
/// the project must never be read).
async fn search_directory_fallback(
    base: &str,
    resolved_scope: &str,
    query: &str,
    include_ignored: bool,
    results: &mut Vec<SearchContentResult>,
) {
    let all_files = list_project_files(base, include_ignored).await;
    let scope_rel = relative(Path::new(base), Path::new(resolved_scope));
    let scope_prefix = if scope_rel.is_empty() {
        String::new()
    } else {
        format!("{scope_rel}{}", std::path::MAIN_SEPARATOR)
    };

    let mut scanned = 0;
    for rel_file in all_files {
        if results.len() >= MAX_RESULTS || scanned >= MAX_FILES_SCANNED {
            break;
        }
        if !scope_rel.is_empty() && !rel_file.starts_with(&scope_prefix) && rel_file != scope_rel {
            continue;
        }
        if has_binary_extension(&rel_file) {
            continue;
        }
        let Some(abs_file) = resolve_within_base(base, &rel_file).await else {
            scanned += 1;
            continue;
        };
        let file_meta = match tokio::fs::metadata(&abs_file).await {
            Ok(m) => m,
            Err(_) => continue, // vanished between listing and stat
        };
        if file_meta.len() > MAX_FILE_SIZE {
            scanned += 1;
            continue;
        }
        search_file(&abs_file, &rel_file, query, results, MAX_RESULTS).await;
        scanned += 1;
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/projects/{id}/search/content", get(content_search))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn search_file_finds_multiple_columns_and_lines() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("f.txt");
        std::fs::write(&file, "foo foo\nbar\nFOO\n").unwrap();
        let mut results = Vec::new();
        search_file(
            &file.to_string_lossy(),
            "f.txt",
            "foo",
            &mut results,
            MAX_RESULTS,
        )
        .await;
        assert_eq!(results.len(), 3);
        assert_eq!((results[0].line, results[0].column), (1, 1));
        assert_eq!((results[1].line, results[1].column), (1, 5));
        assert_eq!((results[2].line, results[2].column), (3, 1)); // case-insensitive
    }

    #[tokio::test]
    async fn search_file_skips_binary_content() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("bin");
        std::fs::write(&file, b"ab\0cdfoo").unwrap();
        let mut results = Vec::new();
        search_file(
            &file.to_string_lossy(),
            "bin",
            "foo",
            &mut results,
            MAX_RESULTS,
        )
        .await;
        assert!(results.is_empty());
    }

    #[test]
    fn char_index_of_respects_start() {
        let hay: Vec<char> = "abcabc".chars().collect();
        let ndl: Vec<char> = "abc".chars().collect();
        assert_eq!(char_index_of(&hay, &ndl, 0), Some(0));
        assert_eq!(char_index_of(&hay, &ndl, 1), Some(3));
        assert_eq!(char_index_of(&hay, &ndl, 4), None);
    }
}

// PORT STATUS: src/server/routes/search.ts (handleContentSearch + searchFile)
// confidence: high
// todos: 0
// notes: getEffectivePath → files::resolve_base (raw base), then a separate
// realpath (404 "Project not found" on failure), matching the TS two-step. The
// ripgrep-first / JS-fallback branch is preserved verbatim, including the
// per-file `resolveWithinBase` containment recheck that stops an in-repo symlink
// from leaking out-of-project content (search-symlink-fallback.test.ts). Zod
// custom messages ("Query must be at least 2 characters", "path is required")
// reproduced exactly; a missing param yields "Required". `listProjectFiles`
// cannot throw in Rust (returns Vec), so the TS 500 "Failed to list project
// files" branch is unreachable here — noted, not wired. Line/column indices are
// char-based (TS was UTF-16 code units); unobservable for ASCII sources.
