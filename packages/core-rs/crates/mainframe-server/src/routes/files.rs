//! Eight endpoints over project files and the filesystem: directory tree,
//! file-name search, flat file listing, GET/PUT file content, path resolution,
//! external absolute-path read, and filesystem browse. Every project-scoped path
//! flows through `resolve_and_validate_path` / `resolve_readable_path` (symlink
//! containment); the two non-project endpoints guard with a sensitive-path
//! blocklist and realpath.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path as AxPath, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Serialize;

use crate::ctx::AppCtx;
use crate::fs_utils::{has_binary_extension, is_ignored_dir, path_resolve, relative};
use crate::input_error::InputError;
use crate::path_utils::resolve_readable_path;
use crate::respond::{fail, ok};
use crate::ripgrep::{ListFilesOptions, list_files_with_ripgrep};
use mainframe_runtime::fs::resolve_and_validate_path;

const TREE_HIDDEN: &[&str] = &[".git"];

/// A tree / browse directory entry (`{ name, type, path }`).
#[derive(Serialize)]
struct FsEntry {
    name: String,
    #[serde(rename = "type")]
    entry_type: &'static str,
    path: String,
}

pub(crate) async fn resolve_base(
    ctx: &AppCtx,
    project_id: &str,
    chat_id: Option<&str>,
) -> Result<String, crate::respond::ApiError> {
    ctx.resolve_scope(project_id, chat_id)
        .await
        .map(|scope| scope.path)
        .map_err(Into::into)
}

fn qget<'a>(q: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    q.get(key).map(String::as_str)
}

// ── GET /api/projects/:id/tree ───────────────────────────────────────────────

async fn tree(
    State(ctx): State<Arc<AppCtx>>,
    AxPath(id): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let base = match resolve_base(&ctx, &id, qget(&q, "chatId")).await {
        Ok(b) => b,
        Err(resp) => return resp.into_response(),
    };
    // `req.query.path || '.'` — an empty string is falsy → '.'.
    let dir_path = qget(&q, "path").filter(|p| !p.is_empty()).unwrap_or(".");

    let Some(full) = resolve_and_validate_path(&base, dir_path).await else {
        return fail(StatusCode::FORBIDDEN, "Path outside project");
    };
    match read_dir_entries(&full, &base, true).await {
        Some(entries) => ok(entries),
        None => fail(StatusCode::NOT_FOUND, "Directory not found"),
    }
}

/// Read one directory into sorted `FsEntry`s. `.git` is hidden; symlinks are
/// resolved via `metadata` (broken ones skipped). Paths are project-relative.
async fn read_dir_entries(full: &str, base: &str, hide_git: bool) -> Option<Vec<FsEntry>> {
    let mut read_dir = tokio::fs::read_dir(full).await.ok()?;
    let mut entries: Vec<FsEntry> = Vec::new();
    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if hide_git && TREE_HIDDEN.contains(&name.as_str()) {
            continue;
        }
        let entry_path = Path::new(full).join(&name);
        let Some(entry_type) = entry_dir_or_file(&entry, &entry_path).await else {
            continue; // broken symlink / race
        };
        entries.push(FsEntry {
            name,
            entry_type,
            path: relative(Path::new(base), &entry_path),
        });
    }
    sort_entries(&mut entries);
    Some(entries)
}

/// Classify a dirent as `"file"`/`"directory"`, resolving symlinks via a
/// following `metadata` call; `None` when the (symlinked) target is unreachable.
async fn entry_dir_or_file(entry: &tokio::fs::DirEntry, entry_path: &Path) -> Option<&'static str> {
    let ft = entry.file_type().await.ok()?;
    let is_dir = if ft.is_symlink() {
        tokio::fs::metadata(entry_path).await.ok()?.is_dir()
    } else {
        ft.is_dir()
    };
    Some(if is_dir { "directory" } else { "file" })
}

fn sort_entries(entries: &mut [FsEntry]) {
    entries.sort_by(|a, b| match (a.entry_type, b.entry_type) {
        ("directory", "file") => std::cmp::Ordering::Less,
        ("file", "directory") => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
}

// ── GET /api/projects/:id/search/files ───────────────────────────────────────

#[derive(Serialize)]
struct FileHit {
    name: String,
    path: String,
    #[serde(rename = "type")]
    entry_type: &'static str,
}

async fn search_files(
    State(ctx): State<Arc<AppCtx>>,
    AxPath(id): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let base = match resolve_base(&ctx, &id, qget(&q, "chatId")).await {
        Ok(b) => b,
        Err(resp) => return resp.into_response(),
    };
    let query = qget(&q, "q").unwrap_or("").to_lowercase();
    if query.is_empty() {
        return ok(Vec::<FileHit>::new());
    }
    if tokio::fs::canonicalize(&base).await.is_err() {
        return crate::respond::ApiError::project_not_found().into_response();
    }
    let limit = parse_limit(qget(&q, "limit"), 50, 200);
    let scan_limit = limit.saturating_mul(4);

    let mut substrings: Vec<FileHit> = Vec::new();
    let mut fuzzies: Vec<FileHit> = Vec::new();

    let files = list_files_with_ripgrep(
        &base,
        &ListFilesOptions {
            use_builtin_ignore_only: true,
            ..Default::default()
        },
    )
    .await;
    for rel in files {
        if substrings.len() + fuzzies.len() >= scan_limit {
            break;
        }
        add_file_hit(&mut substrings, &mut fuzzies, &rel, false, &query);
    }

    let combined: Vec<FileHit> = substrings.into_iter().chain(fuzzies).take(limit).collect();
    ok(combined)
}

/// File-picker candidacy: skip dirs and binary files; a substring match is
/// "exact", otherwise a subsequence (fuzzy) match qualifies.
fn add_file_hit(
    substrings: &mut Vec<FileHit>,
    fuzzies: &mut Vec<FileHit>,
    rel: &str,
    is_dir: bool,
    query: &str,
) {
    if is_dir || has_binary_extension(rel) {
        return;
    }
    let rel_lower = rel.to_lowercase();
    let name = basename(rel);
    if rel_lower.contains(query) {
        substrings.push(FileHit {
            name,
            path: rel.to_string(),
            entry_type: "file",
        });
    } else if fuzzy_match(query, &rel_lower) {
        fuzzies.push(FileHit {
            name,
            path: rel.to_string(),
            entry_type: "file",
        });
    }
}

fn fuzzy_match(query: &str, target: &str) -> bool {
    let q: Vec<char> = query.chars().collect();
    let mut qi = 0;
    for tc in target.chars() {
        if qi >= q.len() {
            break;
        }
        if tc == q[qi] {
            qi += 1;
        }
    }
    qi == q.len()
}

// ── GET /api/projects/:id/files-list ─────────────────────────────────────────

async fn files_list(
    State(ctx): State<Arc<AppCtx>>,
    AxPath(id): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let base = match resolve_base(&ctx, &id, qget(&q, "chatId")).await {
        Ok(b) => b,
        Err(resp) => return resp.into_response(),
    };
    let limit = parse_limit(qget(&q, "limit"), 5000, 5000);
    if tokio::fs::canonicalize(&base).await.is_err() {
        return crate::respond::ApiError::project_not_found().into_response();
    }

    let mut files: Vec<String> = Vec::new();
    let mut stack = vec![base.clone()];
    while let Some(dir) = stack.pop() {
        if files.len() >= limit {
            break;
        }
        let Ok(mut read_dir) = tokio::fs::read_dir(&dir).await else {
            tracing::warn!(dir, "Failed to read directory during file listing");
            continue;
        };
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            if files.len() >= limit {
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_ignored_dir(&name) {
                continue;
            }
            let joined = Path::new(&dir).join(&name);
            let joined_str = joined.to_string_lossy().into_owned();
            if resolve_and_validate_path(&base, &joined_str)
                .await
                .is_none()
            {
                continue;
            }
            if entry
                .file_type()
                .await
                .map(|ft| ft.is_dir())
                .unwrap_or(false)
            {
                stack.push(joined_str);
            } else {
                files.push(relative(Path::new(&base), &joined));
            }
        }
    }
    ok(files)
}

// ── GET /api/projects/:id/files ──────────────────────────────────────────────

async fn file_content(
    State(ctx): State<Arc<AppCtx>>,
    AxPath(id): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let base = match resolve_base(&ctx, &id, qget(&q, "chatId")).await {
        Ok(b) => b,
        Err(resp) => return resp.into_response(),
    };
    let Some(file_path) = qget(&q, "path").filter(|p| !p.is_empty()) else {
        return fail(StatusCode::BAD_REQUEST, "path query required");
    };
    let is_base64 = qget(&q, "encoding") == Some("base64");

    let Some(full) = resolve_readable_path(&base, file_path).await else {
        return fail(StatusCode::FORBIDDEN, "Path outside project");
    };
    let Ok(meta) = tokio::fs::metadata(&full).await else {
        return fail(StatusCode::NOT_FOUND, "File not found");
    };
    let max_mb: u64 = if is_base64 { 10 } else { 2 };
    if meta.len() > max_mb * 1024 * 1024 {
        return fail(
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("File too large (max {max_mb}MB)"),
        );
    }
    let Ok(bytes) = tokio::fs::read(&full).await else {
        return fail(StatusCode::NOT_FOUND, "File not found");
    };
    if is_base64 {
        ok(
            serde_json::json!({ "path": file_path, "content": mainframe_types::base64_data::encode(&bytes), "encoding": "base64" }),
        )
    } else {
        ok(serde_json::json!({ "path": file_path, "content": String::from_utf8_lossy(&bytes) }))
    }
}

// ── PUT /api/projects/:id/files ──────────────────────────────────────────────

async fn write_file(
    State(ctx): State<Arc<AppCtx>>,
    AxPath(id): AxPath<String>,
    body: Bytes,
) -> Response {
    let parsed: serde_json::Value =
        serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    let chat_id = parsed.get("chatId").and_then(|v| v.as_str());
    let file_path = match require_nonempty_string(&parsed, "path") {
        Ok(p) => p,
        Err(err) => return crate::respond::fail_with(&err),
    };
    // `content` must be a string (an empty string is valid). Missing/non-string
    // returns the Zod v4 type-mismatch message.
    let content = match parsed.get("content") {
        None => {
            return fail(
                StatusCode::BAD_REQUEST,
                "Invalid input: expected string, received undefined",
            );
        }
        Some(serde_json::Value::String(s)) => s.as_str(),
        Some(other) => return fail(StatusCode::BAD_REQUEST, zod_type_mismatch(other)),
    };

    let base = match resolve_base(&ctx, &id, chat_id).await {
        Ok(b) => b,
        Err(resp) => return resp.into_response(),
    };
    let Some(full) = resolve_and_validate_path(&base, file_path).await else {
        return fail(StatusCode::FORBIDDEN, "Path outside project");
    };
    match tokio::fs::write(&full, content).await {
        Ok(()) => ok(serde_json::json!({ "path": file_path })),
        Err(err) => crate::respond::fail_internal(
            format!("Failed to write file path={}", file_path),
            &err,
            "Failed to write file",
        ),
    }
}

// ── GET /api/projects/:id/paths/resolve ──────────────────────────────────────

async fn resolve_path(
    State(ctx): State<Arc<AppCtx>>,
    AxPath(id): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let requested = match qget(&q, "path") {
        Some(p) if !p.is_empty() => p.to_string(),
        Some(_) => {
            return fail(
                StatusCode::BAD_REQUEST,
                "Too small: expected string to have >=1 characters",
            );
        }
        None => {
            return fail(
                StatusCode::BAD_REQUEST,
                "Invalid input: expected string, received undefined",
            );
        }
    };
    let chat_id = qget(&q, "chatId").map(str::to_string);

    let scope = match ctx.resolve_scope(&id, chat_id.as_deref()).await {
        Ok(scope) => scope,
        Err(error) => return crate::respond::ApiError::from(error).into_response(),
    };
    let base = scope.path;
    let base_kind = if base != scope.project_path {
        "worktree"
    } else {
        "project"
    };
    let (absolute, contained) = resolve_absolute(&base, &requested).await;
    let real_base = tokio::fs::canonicalize(&base)
        .await
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| base.clone());
    let rel = relative(Path::new(&real_base), Path::new(&absolute));

    ok(serde_json::json!({
        "relative": rel,
        "absolute": absolute,
        "baseKind": base_kind,
        "basePath": real_base,
        "contained": contained,
    }))
}

/// Resolve `requested` against `base`: strict containment → `contained:true`;
/// the `~/.claude` readable fallback or a best-effort realpath → `contained:false`.
async fn resolve_absolute(base: &str, requested: &str) -> (String, bool) {
    if let Some(strict) = resolve_and_validate_path(base, requested).await {
        return (strict, true);
    }
    if let Some(broad) = resolve_readable_path(base, requested).await {
        return (broad, false);
    }
    let lexical = path_resolve(base, requested);
    let absolute = tokio::fs::canonicalize(&lexical)
        .await
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(lexical);
    (absolute, false)
}

// ── GET /api/files/external ──────────────────────────────────────────────────

const BLOCKED_PREFIXES: &[&str] = &["/etc/shadow", "/etc/master.passwd", "/etc/sudoers"];

/// Minimal sensitive-path blocklist (the user opens these explicitly, so most
/// paths are allowed): shadow/sudoers prefixes plus the private-secret patterns
/// (SSH private keys, `.aws/credentials`, `.netrc`, `.gnupg/` keyrings).
fn is_blocked_external(resolved: &str) -> bool {
    if BLOCKED_PREFIXES
        .iter()
        .any(|p| resolved == *p || resolved.starts_with(&format!("{p}/")))
    {
        return true;
    }
    resolved.contains("/.ssh/id_")
        || resolved.ends_with("/.aws/credentials")
        || resolved.ends_with("/.netrc")
        || resolved.contains("/.gnupg/")
}

async fn external_file_content(Query(q): Query<HashMap<String, String>>) -> Response {
    let requested = match qget(&q, "path") {
        Some(p) if !p.is_empty() => p.to_string(),
        Some(_) => {
            return fail(
                StatusCode::BAD_REQUEST,
                "Too small: expected string to have >=1 characters",
            );
        }
        None => {
            return fail(
                StatusCode::BAD_REQUEST,
                "Invalid input: expected string, received undefined",
            );
        }
    };
    // `encoding` is absent, or exactly "base64".
    let encoding = qget(&q, "encoding");
    if let Some(enc) = encoding
        && enc != "base64"
    {
        return fail(
            StatusCode::BAD_REQUEST,
            "Invalid option: expected one of \"base64\"",
        );
    }
    let is_base64 = encoding == Some("base64");
    // Blocklist the raw path first so sensitive targets are rejected even when
    // the file does not exist.
    if is_blocked_external(&requested) {
        return fail(StatusCode::FORBIDDEN, "Access to this path is not allowed");
    }
    let Ok(resolved) = tokio::fs::canonicalize(&requested).await else {
        return fail(StatusCode::NOT_FOUND, "File not found");
    };
    let resolved = resolved.to_string_lossy().into_owned();
    if is_blocked_external(&resolved) {
        return fail(StatusCode::FORBIDDEN, "Access to this path is not allowed");
    }
    let Ok(meta) = tokio::fs::metadata(&resolved).await else {
        tracing::warn!(path = resolved, "Failed to stat external file");
        return fail(StatusCode::NOT_FOUND, "File not found");
    };
    if !meta.is_file() {
        return fail(StatusCode::BAD_REQUEST, "Path is not a file");
    }
    // Same limits as the project files route: binary viewers need more headroom.
    let max_mb: u64 = if is_base64 { 10 } else { 2 };
    if meta.len() > max_mb * 1024 * 1024 {
        return fail(
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("File too large (max {max_mb}MB)"),
        );
    }
    match tokio::fs::read(&resolved).await {
        Ok(bytes) => {
            if is_base64 {
                ok(
                    serde_json::json!({ "path": resolved, "content": mainframe_types::base64_data::encode(&bytes), "encoding": "base64" }),
                )
            } else {
                ok(
                    serde_json::json!({ "path": resolved, "content": String::from_utf8_lossy(&bytes) }),
                )
            }
        }
        Err(err) => crate::respond::fail_internal(
            format!("Failed to read external file path={}", resolved),
            &err,
            "Failed to read file",
        ),
    }
}

// ── GET /api/filesystem/browse ───────────────────────────────────────────────

async fn browse_filesystem(Query(q): Query<HashMap<String, String>>) -> Response {
    let include_files = match parse_booleanish(qget(&q, "includeFiles")) {
        Ok(v) => v,
        Err(()) => return fail(StatusCode::BAD_REQUEST, "Invalid input"),
    };
    let include_hidden = match parse_booleanish(qget(&q, "includeHidden")) {
        Ok(v) => v,
        Err(()) => return fail(StatusCode::BAD_REQUEST, "Invalid input"),
    };
    let Some(home) = dirs::home_dir() else {
        return fail(StatusCode::NOT_FOUND, "Directory not found");
    };
    let home = home.to_string_lossy().into_owned();
    let requested = qget(&q, "path").filter(|p| !p.is_empty()).unwrap_or(&home);
    let requested = if let Some(rest) = requested.strip_prefix('~') {
        format!("{home}{rest}")
    } else {
        requested.to_string()
    };
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "/".to_string());
    let normalized = path_resolve(&cwd, &requested);
    let Ok(real) = tokio::fs::canonicalize(&normalized).await else {
        return fail(StatusCode::NOT_FOUND, "Directory not found");
    };
    let real = real.to_string_lossy().into_owned();

    match browse_entries(&real, include_files, include_hidden).await {
        Some(entries) => ok(serde_json::json!({ "path": real, "entries": entries })),
        None => fail(StatusCode::NOT_FOUND, "Directory not found"),
    }
}

async fn browse_entries(
    real: &str,
    include_files: bool,
    include_hidden: bool,
) -> Option<Vec<FsEntry>> {
    let mut read_dir = tokio::fs::read_dir(real).await.ok()?;
    let mut entries: Vec<FsEntry> = Vec::new();
    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(ft) = entry.file_type().await else {
            continue;
        };
        if !ft.is_dir() && !ft.is_file() && !ft.is_symlink() {
            continue;
        }
        if !include_hidden && name.starts_with('.') {
            continue;
        }
        if is_ignored_dir(&name) {
            continue;
        }
        if !include_files && !ft.is_dir() && !ft.is_symlink() {
            continue;
        }
        let entry_path = Path::new(real).join(&name);
        let Some(entry_type) = entry_dir_or_file(&entry, &entry_path).await else {
            continue;
        };
        if !include_files && entry_type == "file" {
            continue;
        }
        entries.push(FsEntry {
            name,
            entry_type,
            path: entry_path.to_string_lossy().into_owned(),
        });
    }
    sort_entries(&mut entries);
    Some(entries)
}

// ── shared small helpers ─────────────────────────────────────────────────────

fn basename(p: &str) -> String {
    Path::new(p)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.to_string())
}

/// `Math.min(Number(limit) || default, cap)`; a `0`/unparseable value → default.
fn parse_limit(raw: Option<&str>, default: usize, cap: usize) -> usize {
    raw.and_then(|s| s.parse::<i64>().ok())
        .filter(|&n| n != 0)
        .map(|n| n.clamp(0, cap as i64) as usize)
        .unwrap_or(default)
        .min(cap)
}

/// `z.union([boolean, enum(['true','false'])]).optional().transform(v => v===true||v==='true')`.
fn parse_booleanish(raw: Option<&str>) -> Result<bool, ()> {
    match raw {
        None => Ok(false),
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        Some(_) => Err(()),
    }
}

/// Zod v4 message for `z.string()` receiving a non-string value: the `received`
/// suffix is the JSON typeof.
fn zod_type_mismatch(v: &serde_json::Value) -> String {
    InputError::ExpectedString(json_typeof(v)).to_string()
}

/// The JSON `typeof` zod names in a type-mismatch message.
fn json_typeof(v: &serde_json::Value) -> &'static str {
    match v {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
        serde_json::Value::String(_) => "string",
    }
}

fn require_nonempty_string<'a>(v: &'a serde_json::Value, key: &str) -> Result<&'a str, InputError> {
    match v.get(key) {
        None => Err(InputError::ExpectedString("undefined")),
        Some(serde_json::Value::String(s)) if s.is_empty() => Err(InputError::Rejected(
            "Too small: expected string to have >=1 characters",
        )),
        Some(serde_json::Value::String(s)) => Ok(s),
        Some(other) => Err(InputError::ExpectedString(json_typeof(other))),
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/filesystem/browse", get(browse_filesystem))
        .route("/api/files/external", get(external_file_content))
        .route("/api/projects/{id}/paths/resolve", get(resolve_path))
        .route("/api/projects/{id}/tree", get(tree))
        .route("/api/projects/{id}/search/files", get(search_files))
        .route("/api/projects/{id}/files-list", get(files_list))
        .route(
            "/api/projects/{id}/files",
            get(file_content).put(write_file),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_node_buffer() {
        assert_eq!(mainframe_types::base64_data::encode(b""), "");
        assert_eq!(mainframe_types::base64_data::encode(b"f"), "Zg==");
        assert_eq!(mainframe_types::base64_data::encode(b"fo"), "Zm8=");
        assert_eq!(mainframe_types::base64_data::encode(b"foo"), "Zm9v");
        assert_eq!(
            mainframe_types::base64_data::encode(b"hello world\n"),
            "aGVsbG8gd29ybGQK"
        );
    }

    #[test]
    fn fuzzy_match_is_subsequence() {
        assert!(fuzzy_match("hlo", "hello"));
        assert!(!fuzzy_match("xyz", "hello"));
        assert!(fuzzy_match("abc", "aXbXc"));
    }

    #[test]
    fn parse_limit_clamps_and_defaults() {
        assert_eq!(parse_limit(None, 50, 200), 50);
        assert_eq!(parse_limit(Some("30"), 50, 200), 30);
        assert_eq!(parse_limit(Some("0"), 50, 200), 50);
        assert_eq!(parse_limit(Some("9999"), 50, 200), 200);
        assert_eq!(parse_limit(Some("junk"), 50, 200), 50);
    }

    #[test]
    fn blocklist_rejects_sensitive_paths() {
        assert!(is_blocked_external("/etc/shadow"));
        assert!(is_blocked_external("/etc/sudoers/extra"));
        assert!(is_blocked_external("/home/u/.ssh/id_rsa"));
        assert!(is_blocked_external("/home/u/.aws/credentials"));
        assert!(is_blocked_external("/home/u/.netrc"));
        assert!(is_blocked_external("/home/u/.gnupg/secring.gpg"));
        assert!(!is_blocked_external("/home/u/.aws/config"));
        assert!(!is_blocked_external("/home/u/project/file.txt"));
    }
}
