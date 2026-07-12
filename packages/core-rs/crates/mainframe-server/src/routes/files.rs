//! Ported from `src/server/routes/files.ts`.
//!
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
use axum::response::Response;
use axum::routing::get;
use mainframe_db::{DatabaseManager, DbError};
use mainframe_types::chat::{Chat, Project};
use serde::Serialize;

use crate::async_err::internal_error;
use crate::ctx::AppCtx;
use crate::fs_utils::{has_binary_extension, is_ignored_dir, path_resolve, relative};
use crate::path_utils::{resolve_and_validate_path, resolve_readable_path};
use crate::respond::{fail, ok};
use crate::ripgrep::{ListFilesOptions, list_files_with_ripgrep};

const TREE_HIDDEN: &[&str] = &[".git"];

/// A tree / browse directory entry (`{ name, type, path }`).
#[derive(Serialize)]
struct FsEntry {
    name: String,
    #[serde(rename = "type")]
    entry_type: &'static str,
    path: String,
}

// ── effective-path resolution ────────────────────────────────────────────────

/// Sync `getEffectivePath` (runs on the DB thread). Mirrors `types.ts`: project
/// not found → `None`; a `chatId` from a different project → `None`; a live
/// worktree wins over the project root. `worktreeMissing` is a ChatManager
/// runtime field absent from the DB (always `None` here) → the missing-worktree
/// short-circuit is a Phase-4/5 seam.
pub(crate) fn effective_path_sync(
    db: &DatabaseManager,
    project_id: &str,
    chat_id: Option<&str>,
) -> Result<Option<String>, DbError> {
    let Some(project) = db.projects.get(project_id)? else {
        return Ok(None);
    };
    if let Some(cid) = chat_id
        && let Some(chat) = db.chats.get(cid)?
    {
        if chat.project_id != project_id {
            return Ok(None);
        }
        if let Some(worktree) = chat.worktree_path {
            // TODO(port-phase4/5): honor ChatManager's runtime worktreeMissing.
            if chat.worktree_missing == Some(true) {
                return Ok(None);
            }
            return Ok(Some(worktree));
        }
    }
    Ok(Some(project.path))
}

/// Handler-side base resolver: `Ok(base)` or an already-built `404`/`500`
/// response. Wraps [`effective_path_sync`] on the DB thread.
pub(crate) async fn resolve_base(
    ctx: &AppCtx,
    project_id: &str,
    chat_id: Option<&str>,
) -> Result<String, Response> {
    let pid = project_id.to_string();
    let cid = chat_id.map(str::to_string);
    match ctx
        .db
        .call(move |db| effective_path_sync(db, &pid, cid.as_deref()))
        .await
    {
        Ok(Some(base)) => Ok(base),
        Ok(None) => Err(fail(StatusCode::NOT_FOUND, "Project not found")),
        Err(err) => Err(internal_error("resolving effective path", &err)),
    }
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
        Err(resp) => return resp,
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
        Err(resp) => return resp,
    };
    let query = qget(&q, "q").unwrap_or("").to_lowercase();
    if query.is_empty() {
        return ok(Vec::<FileHit>::new());
    }
    if tokio::fs::canonicalize(&base).await.is_err() {
        return fail(StatusCode::NOT_FOUND, "Project not found");
    }
    let limit = parse_limit(qget(&q, "limit"), 50, 200);
    let scan_limit = limit.saturating_mul(4);

    let mut substrings: Vec<FileHit> = Vec::new();
    let mut fuzzies: Vec<FileHit> = Vec::new();

    match list_files_with_ripgrep(
        &base,
        &ListFilesOptions {
            use_builtin_ignore_only: true,
            ..Default::default()
        },
    )
    .await
    {
        Some(files) => {
            for rel in files {
                if substrings.len() + fuzzies.len() >= scan_limit {
                    break;
                }
                add_file_hit(&mut substrings, &mut fuzzies, &rel, false, &query);
            }
        }
        None => {
            search_walk(&base, &query, scan_limit, &mut substrings, &mut fuzzies).await;
        }
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

/// Recursive-walk fallback (ripgrep unavailable): each entry is containment-
/// validated before it counts toward the scan budget.
async fn search_walk(
    base: &str,
    query: &str,
    scan_limit: usize,
    substrings: &mut Vec<FileHit>,
    fuzzies: &mut Vec<FileHit>,
) {
    let mut stack = vec![base.to_string()];
    while let Some(dir) = stack.pop() {
        if substrings.len() + fuzzies.len() >= scan_limit {
            return;
        }
        let Ok(mut read_dir) = tokio::fs::read_dir(&dir).await else {
            tracing::warn!(dir, "Failed to read directory during file search");
            continue;
        };
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            if substrings.len() + fuzzies.len() >= scan_limit {
                return;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_ignored_dir(&name) {
                continue;
            }
            let joined = Path::new(&dir).join(&name);
            let joined_str = joined.to_string_lossy().into_owned();
            if resolve_and_validate_path(base, &joined_str).await.is_none() {
                continue;
            }
            let rel = relative(Path::new(base), &joined);
            let is_dir = entry
                .file_type()
                .await
                .map(|ft| ft.is_dir())
                .unwrap_or(false);
            add_file_hit(substrings, fuzzies, &rel, is_dir, query);
            if is_dir {
                stack.push(joined_str);
            }
        }
    }
}

// ── GET /api/projects/:id/files-list ─────────────────────────────────────────

async fn files_list(
    State(ctx): State<Arc<AppCtx>>,
    AxPath(id): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let base = match resolve_base(&ctx, &id, qget(&q, "chatId")).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    let limit = parse_limit(qget(&q, "limit"), 5000, 5000);
    if tokio::fs::canonicalize(&base).await.is_err() {
        return fail(StatusCode::NOT_FOUND, "Project not found");
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
        Err(resp) => return resp,
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
            serde_json::json!({ "path": file_path, "content": base64_encode(&bytes), "encoding": "base64" }),
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
        Err(msg) => return fail(StatusCode::BAD_REQUEST, msg),
    };
    // WriteFileBody.content = z.string() (no `.min(1)`, so an empty string is
    // valid). Missing/non-string reproduces the Zod v4 type-mismatch prose.
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
        Err(resp) => return resp,
    };
    let Some(full) = resolve_and_validate_path(&base, file_path).await else {
        return fail(StatusCode::FORBIDDEN, "Path outside project");
    };
    match tokio::fs::write(&full, content).await {
        Ok(()) => ok(serde_json::json!({ "path": file_path })),
        Err(err) => {
            tracing::warn!(error = %err, path = file_path, "Failed to write file");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "Failed to write file")
        }
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

    let pid = id.clone();
    let cid = chat_id.clone();
    let lookup = ctx
        .db
        .call(move |db| Ok((db.projects.get(&pid)?, chat_lookup(db, cid.as_deref())?)))
        .await;
    let (project, chat) = match lookup {
        Ok(v) => v,
        Err(err) => return internal_error("resolving path", &err),
    };
    let Some(project) = project else {
        return fail(StatusCode::NOT_FOUND, "Project not found");
    };
    // Phase-4/5 seam: worktreeMissing is a ChatManager runtime field (always
    // None from the DB) — the 409 branch is structurally present but inert here.
    if let Some(chat) = &chat
        && chat.worktree_missing == Some(true)
    {
        return fail(StatusCode::CONFLICT, "Worktree missing");
    }
    let Some(base) = effective_from(&project, chat.as_ref(), &id) else {
        return fail(StatusCode::NOT_FOUND, "Project not found");
    };

    let base_kind = if base != project.path {
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

fn chat_lookup(db: &DatabaseManager, chat_id: Option<&str>) -> Result<Option<Chat>, DbError> {
    match chat_id {
        Some(cid) => db.chats.get(cid),
        None => Ok(None),
    }
}

fn effective_from(project: &Project, chat: Option<&Chat>, project_id: &str) -> Option<String> {
    if let Some(chat) = chat {
        if chat.project_id != project_id {
            return None;
        }
        if let Some(worktree) = &chat.worktree_path {
            if chat.worktree_missing == Some(true) {
                return None;
            }
            return Some(worktree.clone());
        }
    }
    Some(project.path.clone())
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
    // encoding: z.enum(['base64']).optional() — absent, or exactly "base64".
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
                    serde_json::json!({ "path": resolved, "content": base64_encode(&bytes), "encoding": "base64" }),
                )
            } else {
                ok(
                    serde_json::json!({ "path": resolved, "content": String::from_utf8_lossy(&bytes) }),
                )
            }
        }
        Err(err) => {
            tracing::warn!(error = %err, path = resolved, "Failed to read external file");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "Failed to read file")
        }
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
/// suffix is the JSON typeof (`Buffer.toString('base64')`-style prose parity).
fn zod_type_mismatch(v: &serde_json::Value) -> String {
    let received = match v {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
        serde_json::Value::String(_) => "string",
    };
    format!("Invalid input: expected string, received {received}")
}

fn require_nonempty_string<'a>(v: &'a serde_json::Value, key: &str) -> Result<&'a str, String> {
    match v.get(key) {
        None => Err("Invalid input: expected string, received undefined".to_string()),
        Some(serde_json::Value::String(s)) if s.is_empty() => {
            Err("Too small: expected string to have >=1 characters".to_string())
        }
        Some(serde_json::Value::String(s)) => Ok(s),
        Some(other) => Err(zod_type_mismatch(other)),
    }
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding — matches Node `Buffer.toString('base64')`.
fn base64_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(B64[((n >> 18) & 63) as usize] as char);
        out.push(B64[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            B64[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
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
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"hello world\n"), "aGVsbG8gd29ybGQK");
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

// PORT STATUS: src/server/routes/files.ts (8 endpoints) + types.ts getEffectivePath
// confidence: high
// todos: 2
// notes: getEffectivePath (from types.ts) lives here as effective_path_sync until
// a shared routes-helpers module exists — TODO(port): consolidate once all
// Phase-3 route files land (git.rs et al. need it too). worktreeMissing is a
// ChatManager runtime field absent from the DB, so the missing-worktree
// short-circuit (null / 409) is a Phase-4/5 seam (always inert here). Zod v4
// `validate()` 400 bodies reproduced byte-for-byte ("Invalid input: expected
// string, received undefined", "Too small: expected string to have >=1
// characters", the type-mismatch prose) + the booleanish union's "Invalid
// input". `path.relative`/`path.resolve` via fs_utils shims;
// realpathSync → tokio canonicalize. Tree/browse sort uses byte Ord (not JS
// localeCompare) — ordering is unasserted. base64 hand-rolled (no crate in the
// allowlist), verified against Node Buffer vectors. Main catch-up (#436): the
// external-file route accepts `encoding=base64` (10MB cap, base64 body +
// `encoding:'base64'`; else 2MB utf-8) and the blocklist adds `.aws/credentials`,
// `.netrc`, and `.gnupg/`.
