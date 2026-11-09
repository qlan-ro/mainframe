//! Shows claude.ai artifacts in the workspace from a local download.
//!
//! claude.ai needs its own login and refuses to be framed, so `POST` downloads the
//! artifact into a versioned cache (see `cache`) and `GET` serves it. Everything
//! served is untrusted page content: a CSP `sandbox` gives it an opaque origin, and
//! its only reachable daemon paths are its own version's files, so it can't call any
//! other route. Beyond those, only Google Fonts answers.

mod cache;
mod compose;
mod recover;
mod retention;

use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::ctx::AppCtx;
use crate::respond::{fail, fail_internal, ok};

const ARTIFACT_URL_PREFIX: &str = "https://claude.ai/artifact/";
const INDEX_PAGE: &str = "index";
const RUNTIME_ENTRY: &str = "support.js";
const PICKER_ENTRY: &str = "picker.js";
const PICKER_JS: &str = include_str!("artifact_preview/picker.js");
const CANVAS_ENTRY: &str = "mf-canvas.js";
const CANVAS_JS: &str = include_str!("artifact_preview/canvas.js");
const CANVAS_INDEX: &str = "project/canvas.json";
const DECK_INDEX: &str = "project/deck.json";
const ROOT_PAGE: &str = "index.html";
/// The script hosts claude.ai lets an artifact load from. A page can already run
/// any inline code here, so these only add fetching what they publish.
const CDNS: &str = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com";
const HTML_TYPE: &str = "text/html; charset=utf-8";
const JS_TYPE: &str = "text/javascript; charset=utf-8";
/// A file missing from a version that is here: a broken reference inside the artifact.
const NOT_FOUND_PAGE: &str = "<!doctype html><meta charset=\"utf-8\"><title>Not found</title>\
<body style=\"font:14px system-ui,sans-serif;padding:24px\">This part of the artifact isn't available.</body>";

#[derive(Debug, Deserialize)]
struct PrepareBody {
    url: String,
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/artifacts/preview", post(prepare))
        .route("/api/artifact-preview/{slug}/{version}/{*path}", get(serve))
}

fn is_identifier(text: &str) -> bool {
    !text.is_empty()
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn slug_of(url: &str) -> Option<&str> {
    url.strip_prefix(ARTIFACT_URL_PREFIX)
        .filter(|slug| is_identifier(slug))
}

async fn prepare(
    State(ctx): State<Arc<AppCtx>>,
    axum::Json(body): axum::Json<PrepareBody>,
) -> Response {
    let Some(slug) = slug_of(&body.url) else {
        return fail(StatusCode::BAD_REQUEST, "Not a claude.ai artifact URL");
    };
    match recover::download(&ctx, slug).await {
        Ok(Some(ready)) => ok(json!({
            "status": "ready",
            "path": format!("/api/artifact-preview/{slug}/{}/{INDEX_PAGE}", ready.version),
            "title": ready.title,
        })),
        Ok(None) => ok(json!({ "status": "unsupported" })),
        Err(error) => fail_internal(
            "artifact download",
            error,
            "Could not download the artifact",
        ),
    }
}

/// Scopes the page to its own version's files; the `sandbox` makes every other
/// daemon path cross-origin and blocked.
fn sandbox_policy(slug: &str, version: &str) -> String {
    let own = format!(
        "http://127.0.0.1:*/api/artifact-preview/{slug}/{version}/ http://localhost:*/api/artifact-preview/{slug}/{version}/"
    );
    format!(
        "sandbox allow-scripts; default-src 'none'; script-src {own} {CDNS} blob: 'unsafe-inline' 'unsafe-eval'; worker-src {own} blob:; \
style-src {own} {CDNS} 'unsafe-inline' https://fonts.googleapis.com; font-src {own} data: blob: https://fonts.gstatic.com; \
img-src {own} data: blob:; media-src {own} data: blob:; connect-src {own} data: blob:; frame-src {own}; base-uri 'none'; form-action 'none'"
    )
}

fn page(
    policy: &str,
    status: StatusCode,
    content_type: &str,
    body: impl Into<Vec<u8>>,
) -> Response {
    let mut response = (status, body.into()).into_response();
    let headers = response.headers_mut();
    let insert =
        |value: &str| HeaderValue::from_str(value).unwrap_or_else(|_| HeaderValue::from_static(""));
    headers.insert(header::CONTENT_TYPE, insert(content_type));
    headers.insert(header::CONTENT_SECURITY_POLICY, insert(policy));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    // The sandboxed page's origin is `null`, and its runtime fetches sibling files.
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response
}

/// Adds the Inspect picker to a page: right after `<head>` when it has one, so it
/// runs before the page's own scripts, else at the end.
fn with_picker(html: &str, tag: &str) -> String {
    let head_end = html
        .to_ascii_lowercase()
        .find("<head")
        .and_then(|start| html[start..].find('>').map(|end| start + end + 1));
    match head_end {
        Some(end) => format!("{}{tag}{}", &html[..end], &html[end..]),
        None => format!("{html}{tag}"),
    }
}

fn content_type(path: &FsPath) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "html" => HTML_TYPE,
        "css" => "text/css; charset=utf-8",
        // In-page compilers such as Babel fetch these and run them as scripts.
        "js" | "mjs" | "jsx" | "tsx" => JS_TYPE,
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => return None,
    })
}

/// Reads `relative` under `root`. Dotfiles are internal, and symlinks and `..`
/// can't leave `root`.
async fn read_inside(root: &FsPath, relative: &str) -> Option<(PathBuf, Vec<u8>)> {
    let safe = cache::safe_relative(relative)?;
    // Mainframe's own bookkeeping; the artifact's dotfiles, like a migrated design's
    // `.design-canvas.state.json`, are its content.
    if relative == cache::META_FILE {
        return None;
    }
    let path = tokio::fs::canonicalize(root.join(safe)).await.ok()?;
    if !path.starts_with(root) {
        return None;
    }
    let bytes = tokio::fs::read(&path).await.ok()?;
    Some((path, bytes))
}

async fn read_json(root: &FsPath, relative: &str) -> Option<Value> {
    let (_, bytes) = read_inside(root, relative).await?;
    serde_json::from_slice(&bytes).ok()
}

struct Preview<'a> {
    root: &'a FsPath,
    policy: &'a str,
    /// The `<script>` tag for this version's picker.
    picker: &'a str,
}

impl Preview<'_> {
    fn html(&self, body: &str) -> Response {
        page(
            self.policy,
            StatusCode::OK,
            HTML_TYPE,
            with_picker(body, self.picker),
        )
    }

    fn missing(&self) -> Response {
        page(
            self.policy,
            StatusCode::NOT_FOUND,
            HTML_TYPE,
            NOT_FOUND_PAGE,
        )
    }

    async fn file(&self, relative: &str) -> Response {
        let is_runtime = relative.rsplit('/').next() == Some(RUNTIME_ENTRY);
        let path = if is_runtime {
            cache::RUNTIME_FILE
        } else {
            relative
        };
        match read_inside(self.root, path).await {
            Some((path, bytes)) => match content_type(&path) {
                Some(HTML_TYPE) => self.html(&String::from_utf8_lossy(&bytes)),
                Some(kind) => page(self.policy, StatusCode::OK, kind, bytes),
                None => self.missing(),
            },
            None => self.missing(),
        }
    }

    async fn index(&self) -> Response {
        if let Some(canvas) = read_json(self.root, CANVAS_INDEX).await {
            return self.html(&compose::design_index(&canvas, CANVAS_ENTRY));
        }
        if let Some(deck) = read_json(self.root, DECK_INDEX).await {
            return self.html(&compose::deck_index(&deck));
        }
        match cache::read_meta(self.root).await {
            Some(meta) if !meta.pages.is_empty() => {
                self.html(&compose::pages_index(&meta.title, &meta.pages))
            }
            _ => self.file(ROOT_PAGE).await,
        }
    }

    async fn slide(&self, id: &str) -> Response {
        let Some(deck) = read_json(self.root, DECK_INDEX).await else {
            return self.missing();
        };
        match read_inside(self.root, &format!("project/slides/{id}.html")).await {
            Some((_, fragment)) => self.html(&compose::slide_page(
                &deck,
                &String::from_utf8_lossy(&fragment),
            )),
            None => self.missing(),
        }
    }
}

async fn serve(
    State(ctx): State<Arc<AppCtx>>,
    Path((slug, version, path)): Path<(String, String, String)>,
) -> Response {
    if !is_identifier(&slug) || !is_identifier(&version) {
        return fail(StatusCode::NOT_FOUND, "Not found");
    }
    let policy = sandbox_policy(&slug, &version);
    let dir = cache::version_dir(&ctx.core.data_dir, &slug, &version);
    let Ok(root) = tokio::fs::canonicalize(dir).await else {
        let unavailable = || {
            page(
                &policy,
                StatusCode::NOT_FOUND,
                HTML_TYPE,
                recover::unavailable_page(&slug),
            )
        };
        let download = || recover::download(&ctx, &slug);
        return recover::missing_version(&ctx.core.data_dir, &slug, &path, download, unavailable)
            .await;
    };
    let picker =
        format!(r#"<script src="/api/artifact-preview/{slug}/{version}/{PICKER_ENTRY}"></script>"#);
    let preview = Preview {
        root: &root,
        policy: &policy,
        picker: &picker,
    };
    if path == PICKER_ENTRY {
        return page(&policy, StatusCode::OK, JS_TYPE, PICKER_JS);
    }
    if path == CANVAS_ENTRY {
        return page(&policy, StatusCode::OK, JS_TYPE, CANVAS_JS);
    }
    if path == INDEX_PAGE {
        return preview.index().await;
    }
    if let Some(id) = path.strip_prefix("slide/") {
        return preview.slide(id).await;
    }
    preview.file(&path).await
}

#[cfg(test)]
#[path = "artifact_preview_tests.rs"]
mod tests;
