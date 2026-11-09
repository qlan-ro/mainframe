//! Keeps an open preview tab working after its version leaves the cache.
//!
//! A tab names one version, and that version goes when a newer one replaces it,
//! when it's evicted, or with the data folder. Rather than strand the tab, a
//! request for a missing version moves to a version that is here, or downloads the
//! current one. Only when neither works does the tab say so, with a way to claude.ai.

use std::future::Future;
use std::path::Path as FsPath;
use std::sync::Arc;
use std::time::SystemTime;

use axum::response::{IntoResponse, Redirect, Response};
use mainframe_adapter_api::AdapterError;

use super::cache::{self, META_FILE, ReadyPreview};
use super::compose::escape_html;
use super::retention;
use crate::ctx::AppCtx;
use crate::wiring::refresh::resolve_adapter_path;

const ADAPTER_ID: &str = "claude";
const DEFAULT_BINARY: &str = "claude";
const ARTIFACT_URL_PREFIX: &str = "https://claude.ai/artifact/";
/// The page a tab loads; only it may start a download, so a page's many files don't.
const INDEX_PAGE: &str = "index";

pub(super) fn artifact_url(slug: &str) -> String {
    format!("{ARTIFACT_URL_PREFIX}{slug}")
}

/// Downloads the current version of `slug` if needed, then tidies the cache.
pub(super) async fn download(
    ctx: &Arc<AppCtx>,
    slug: &str,
) -> Result<Option<ReadyPreview>, AdapterError> {
    let binary = resolve_adapter_path(&ctx.core.db, &ctx.core.resolved_path, ADAPTER_ID)
        .await
        .unwrap_or_else(|| DEFAULT_BINARY.to_string());
    let data_dir = &ctx.core.data_dir;
    let prepared = cache::prepare(
        &binary,
        &ctx.core.resolved_path,
        data_dir,
        slug,
        &artifact_url(slug),
    )
    .await;
    let cache_root = cache::cache_root(data_dir);
    retention::tidy(&cache_root, &cache_root.join(slug)).await;
    prepared
}

/// The most recently opened version of `slug` still in the cache.
async fn latest_cached(data_dir: &FsPath, slug: &str) -> Option<String> {
    let artifact_dir = cache::cache_root(data_dir).join(slug);
    let mut entries = tokio::fs::read_dir(artifact_dir).await.ok()?;
    let mut latest: Option<(SystemTime, String)> = None;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Ok(opened) = tokio::fs::metadata(entry.path().join(META_FILE))
            .await
            .and_then(|metadata| metadata.modified())
        else {
            continue;
        };
        let Some(version) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if latest.as_ref().is_none_or(|(time, _)| opened > *time) {
            latest = Some((opened, version));
        }
    }
    latest.map(|(_, version)| version)
}

fn to_version(slug: &str, version: &str, path: &str) -> Response {
    Redirect::temporary(&format!("/api/artifact-preview/{slug}/{version}/{path}")).into_response()
}

/// Shown only when the artifact can't be brought back, so it leads somewhere that
/// may still work. The link opens in the browser: previews can't open windows.
pub(super) fn unavailable_page(slug: &str) -> String {
    let url = escape_html(&artifact_url(slug));
    format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Preview unavailable</title>\
<body style=\"font:14px system-ui,sans-serif;padding:24px;color:#3d3a36\">\
<p>This artifact can't be shown here right now. It may have been deleted, or its content only works on claude.ai.</p>\
<p><a href=\"{url}\" target=\"_blank\" rel=\"noopener\">Open it on claude.ai</a></p></body>"
    )
}

/// Answers a request for a version that isn't cached. `unavailable` renders the
/// fallback page; `download` fetches the current version.
pub(super) async fn missing_version<D, Fut>(
    data_dir: &FsPath,
    slug: &str,
    path: &str,
    download: D,
    unavailable: impl FnOnce() -> Response,
) -> Response
where
    D: FnOnce() -> Fut,
    Fut: Future<Output = Result<Option<ReadyPreview>, AdapterError>>,
{
    if let Some(version) = latest_cached(data_dir, slug).await {
        return to_version(slug, &version, path);
    }
    if path != INDEX_PAGE {
        return unavailable();
    }
    match download().await {
        Ok(Some(ready)) => to_version(slug, &ready.version, path),
        Ok(None) => unavailable(),
        Err(error) => {
            tracing::warn!(error = %error, slug, "could not restore an artifact preview");
            unavailable()
        }
    }
}

#[cfg(test)]
#[path = "recover_tests.rs"]
mod tests;
