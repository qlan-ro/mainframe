//! Ported from `src/server/routes/launch.ts` — the launch-process control routes.
//!
//! Four endpoints under `/api/projects/:id/launch`: `status`, `configs`,
//! `:name/start`, `:name/stop`. Each resolves the worktree-aware effective path
//! (`getEffectivePath`) from the `:id` param + `?chatId`, then delegates to the
//! per-project `LaunchManager` obtained from `ctx.launch_registry`. Launch configs
//! are always read + validated from disk — never trusted from the request body.

use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use mainframe_launch::parse_launch_config;
use serde::Deserialize;
use serde_json::json;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};

/// `?chatId=` — the worktree-scoping selector shared by every launch route.
#[derive(Debug, Deserialize)]
struct ChatQuery {
    #[serde(rename = "chatId")]
    chat_id: Option<String>,
}

/// Resolve the effective launch path for `(project_id, chatId)`, or `None` (→ 404).
async fn resolve_launch_path(
    ctx: &Arc<AppCtx>,
    project_id: &str,
    chat_id: Option<&str>,
) -> Option<String> {
    ctx.effective_path(project_id, chat_id).await
}

/// Parse a `.env` file into key-value pairs. Ignores comments and blank lines —
/// mirrors `parseDotenv` (`^([A-Za-z_][A-Za-z0-9_]*)=(.*)`).
fn parse_dotenv(content: &str) -> HashMap<String, String> {
    let mut env = HashMap::new();
    for line in content.split('\n') {
        if let Some((key, value)) = split_dotenv_line(line) {
            env.insert(key, value);
        }
    }
    env
}

/// Match `^([A-Za-z_][A-Za-z0-9_]*)=(.*)` (no regex crate): an identifier, `=`,
/// then the (possibly empty) rest of the line.
fn split_dotenv_line(line: &str) -> Option<(String, String)> {
    let eq = line.find('=')?;
    let key = &line[..eq];
    let mut chars = key.chars();
    let first = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return None;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    Some((key.to_string(), line[eq + 1..].to_string()))
}

/// Load the project's `.env` and merge with `process.env` (project `.env` wins).
/// Mirrors `loadProjectEnv`; a missing `.env` degrades to just the process env.
async fn load_project_env(project_path: &str) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    let dotenv_path = std::path::Path::new(project_path).join(".env");
    if let Ok(content) = tokio::fs::read_to_string(&dotenv_path).await {
        env.extend(parse_dotenv(&content));
    }
    env
}

async fn get_status(
    State(ctx): State<Arc<AppCtx>>,
    Path(project_id): Path<String>,
    Query(q): Query<ChatQuery>,
) -> Response {
    let Some(path) = resolve_launch_path(&ctx, &project_id, q.chat_id.as_deref()).await else {
        return fail(StatusCode::NOT_FOUND, "Project not found");
    };
    let manager = ctx
        .launch_registry
        .as_ref()
        .map(|r| r.get_or_create(&project_id, &path));
    let statuses = manager
        .as_ref()
        .map(|m| m.get_all_statuses())
        .unwrap_or_default();

    // Include tunnel URLs for running processes (keyed `preview:<name>`).
    let mut tunnel_urls: HashMap<String, String> = HashMap::new();
    if let Some(tunnel_manager) = ctx
        .launch_registry
        .as_ref()
        .and_then(|r| r.tunnel_manager.as_ref())
    {
        for name in statuses.keys() {
            if let Some(url) = tunnel_manager.get_url(&format!("preview:{name}")) {
                tunnel_urls.insert(name.clone(), url);
            }
        }
    }

    // Buffered stdout/stderr per config — a durable replay source for a client
    // whose console mounts after a fast subprocess already finished.
    let mut output_buffer = serde_json::Map::new();
    for name in statuses.keys() {
        let entries: Vec<serde_json::Value> = manager
            .as_ref()
            .map(|m| m.get_output_buffer(name))
            .unwrap_or_default()
            .into_iter()
            .map(|e| json!({ "stream": e.stream, "data": e.data }))
            .collect();
        output_buffer.insert(name.clone(), json!(entries));
    }

    ok(json!({
        "statuses": statuses,
        "tunnelUrls": tunnel_urls,
        "effectivePath": path,
        "outputBuffer": output_buffer,
    }))
}

async fn get_configs(
    State(ctx): State<Arc<AppCtx>>,
    Path(project_id): Path<String>,
    Query(q): Query<ChatQuery>,
) -> Response {
    let Some(path) = resolve_launch_path(&ctx, &project_id, q.chat_id.as_deref()).await else {
        return fail(StatusCode::NOT_FOUND, "Project not found");
    };
    let launch_json_path = std::path::Path::new(&path)
        .join(".mainframe")
        .join("launch.json");
    let raw = match tokio::fs::read_to_string(&launch_json_path).await {
        Ok(raw) => raw,
        // launch.json may not exist → empty list, not an error.
        Err(_) => return ok(json!([])),
    };
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(module = "routes:launch", %err, "invalid launch.json");
            return ok(json!([]));
        }
    };
    let env = load_project_env(&path).await;
    match parse_launch_config(&parsed, &env) {
        Ok(config) => ok(json!(config.configurations)),
        Err(error) => fail(StatusCode::BAD_REQUEST, error),
    }
}

async fn start(
    State(ctx): State<Arc<AppCtx>>,
    Path((project_id, name)): Path<(String, String)>,
    Query(q): Query<ChatQuery>,
) -> Response {
    let Some(path) = resolve_launch_path(&ctx, &project_id, q.chat_id.as_deref()).await else {
        return fail(StatusCode::NOT_FOUND, "Project not found");
    };

    // Read + validate the launch config from disk — never trust the client body.
    let launch_json_path = std::path::Path::new(&path)
        .join(".mainframe")
        .join("launch.json");
    let raw = match tokio::fs::read_to_string(&launch_json_path).await {
        Ok(raw) => raw,
        Err(_) => return fail(StatusCode::NOT_FOUND, "No launch.json found for project"),
    };
    let parsed_json: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(module = "routes:launch", %err, "invalid launch.json");
            return fail(StatusCode::BAD_REQUEST, "Invalid launch.json");
        }
    };
    let env = load_project_env(&path).await;
    let parsed = match parse_launch_config(&parsed_json, &env) {
        Ok(config) => config,
        Err(error) => return fail(StatusCode::BAD_REQUEST, error),
    };
    let Some(config) = parsed.configurations.into_iter().find(|c| c.name == name) else {
        return fail(
            StatusCode::NOT_FOUND,
            format!("Configuration \"{name}\" not found in launch.json"),
        );
    };
    let Some(registry) = ctx.launch_registry.as_ref() else {
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "LaunchRegistry not available",
        );
    };
    let manager = registry.get_or_create(&project_id, &path);
    match manager.start(&config).await {
        Ok(()) => ok_empty(),
        Err(err) => {
            tracing::warn!(
                module = "routes:launch",
                project_id,
                name,
                %err,
                "failed to start launch process"
            );
            fail(StatusCode::INTERNAL_SERVER_ERROR, "Failed to start process")
        }
    }
}

async fn stop(
    State(ctx): State<Arc<AppCtx>>,
    Path((project_id, name)): Path<(String, String)>,
    Query(q): Query<ChatQuery>,
) -> Response {
    let Some(path) = resolve_launch_path(&ctx, &project_id, q.chat_id.as_deref()).await else {
        return fail(StatusCode::NOT_FOUND, "Project not found");
    };
    if let Some(registry) = ctx.launch_registry.as_ref() {
        registry.get_or_create(&project_id, &path).stop(&name).await;
    }
    ok_empty()
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/projects/{id}/launch/status", get(get_status))
        .route("/api/projects/{id}/launch/configs", get(get_configs))
        .route("/api/projects/{id}/launch/{name}/start", post(start))
        .route("/api/projects/{id}/launch/{name}/stop", post(stop))
}

// PORT STATUS: src/server/routes/launch.ts (187 lines)
// confidence: medium
// todos: 0
// notes: getEffectivePath → ctx.effective_path over the Db actor; a missing project
// → 404. `status`/`configs` degrade to empty when launch_registry is None (TS
// optional chaining `ctx.launchRegistry?.…`); `start` returns 500 "LaunchRegistry
// not available" when None, mirroring the `if (!manager)` guard. Launch config is
// always read + validated from disk (`.mainframe/launch.json`) via
// parse_launch_config with a merged process-env + project-.env (parseDotenv
// hand-matches `^([A-Za-z_][A-Za-z0-9_]*)=(.*)`); ok/fail keep the exact envelope
// bytes and status codes. `start`/`stop` success → ok_empty() (`{ success: true }`,
// no `data`); `status`/`configs` → ok(data).

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_dotenv_skips_comments_and_blanks() {
        let env = parse_dotenv("# comment\nFOO=bar\n\nBAZ=qux=quux\nnot a line\n_UNDER=1");
        assert_eq!(env.get("FOO").map(String::as_str), Some("bar"));
        assert_eq!(env.get("BAZ").map(String::as_str), Some("qux=quux"));
        assert_eq!(env.get("_UNDER").map(String::as_str), Some("1"));
        assert_eq!(env.get("# comment"), None);
        assert_eq!(env.len(), 3);
    }

    #[test]
    fn dotenv_rejects_identifier_starting_with_digit() {
        assert_eq!(split_dotenv_line("1FOO=bar"), None);
        assert_eq!(split_dotenv_line("FO-O=bar"), None);
        assert_eq!(
            split_dotenv_line("EMPTY="),
            Some(("EMPTY".to_string(), String::new()))
        );
    }
}
