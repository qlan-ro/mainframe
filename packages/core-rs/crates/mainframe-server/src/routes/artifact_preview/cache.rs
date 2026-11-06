//! Downloads an artifact into a per-version cache.
//!
//! A version never changes once published, so a cached version is served as is and
//! only a new one downloads. Each download lands in a temp folder and is renamed
//! into place, so a failure can't leave a half-filled version behind.

use std::path::{Component, Path as FsPath, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use mainframe_adapter_api::AdapterError;
use mainframe_adapter_claude::artifact_client::{ArtifactClient, ArtifactListing, SavedArtifact};
use mainframe_background_tasks::spool_root::spool_root;
use serde::{Deserialize, Serialize};

const CACHE_DIR: &str = "artifact-cache";
pub(super) const META_FILE: &str = ".preview.json";
pub(super) const DOWNLOAD_PREFIX: &str = ".download-";
pub(super) const RUNTIME_FILE: &str = "artifact-type/dc-runtime.js";
const PROJECT_PREFIX: &str = "project/";
const ROOT_PAGE: &str = "index.html";
const INDEX_FILES: [&str; 2] = ["project/canvas.json", "project/deck.json"];
const MAX_ARTIFACT_BYTES: u64 = 200 * 1024 * 1024;
const READ_BATCH: usize = 50;

static NEXT_DOWNLOAD: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize, Deserialize)]
struct PreviewMeta {
    title: String,
}

#[derive(Debug)]
pub(super) struct ReadyPreview {
    pub version: String,
    pub title: String,
}

pub(super) fn cache_root(data_dir: &FsPath) -> PathBuf {
    data_dir.join(CACHE_DIR)
}

pub(super) fn version_dir(data_dir: &FsPath, slug: &str, version: &str) -> PathBuf {
    cache_root(data_dir).join(slug).join(version)
}

/// Which files make `listing` viewable, or `None` when only claude.ai can show it.
/// Docs and Dashboards keep their content in its database, and a Design System's
/// previews are fragments that claude.ai's page assembles. An untyped artifact is
/// its own page, and lists no files for it.
pub(super) fn files_to_download(listing: &ArtifactListing) -> Option<Vec<String>> {
    let total: u64 = listing.files.iter().map(|file| file.size_bytes).sum();
    if total > MAX_ARTIFACT_BYTES {
        return None;
    }
    if !listing.from_type {
        if listing.files.is_empty() {
            return Some(vec![ROOT_PAGE.to_string()]);
        }
        return Some(listing.files.iter().map(|file| file.path.clone()).collect());
    }
    let mut paths: Vec<String> = listing
        .files
        .iter()
        .map(|file| file.path.clone())
        .filter(|path| path.starts_with(PROJECT_PREFIX) && !path.ends_with(".md"))
        .collect();
    if !paths
        .iter()
        .any(|path| INDEX_FILES.contains(&path.as_str()))
    {
        return None;
    }
    if listing.files.iter().any(|file| file.path == RUNTIME_FILE) {
        paths.push(RUNTIME_FILE.to_string());
    }
    Some(paths)
}

/// `path` as a relative path that stays inside its root, or `None`.
pub(super) fn safe_relative(path: &str) -> Option<PathBuf> {
    let relative = PathBuf::from(path);
    let normal = !path.is_empty()
        && relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)));
    normal.then_some(relative)
}

async fn copy_saved(
    saved: &SavedArtifact,
    target: &FsPath,
    spool: &FsPath,
) -> Result<(), AdapterError> {
    for file in &saved.files {
        let relative = safe_relative(&file.path)
            .ok_or_else(|| AdapterError::Message(format!("unsafe artifact path: {}", file.path)))?;
        let source = tokio::fs::canonicalize(&file.saved_to).await?;
        if !source.starts_with(spool) {
            return Err(AdapterError::Message(format!(
                "artifact file saved outside the scratch folder: {}",
                file.path
            )));
        }
        let destination = target.join(relative);
        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::copy(&source, &destination).await?;
    }
    Ok(())
}

async fn download(
    client: &mut ArtifactClient,
    url: &str,
    paths: &[String],
    target: &FsPath,
) -> Result<String, AdapterError> {
    let spool = tokio::fs::canonicalize(spool_root()).await?;
    let mut title = None;
    for batch in paths.chunks(READ_BATCH) {
        let saved = client.read(url, batch).await?;
        copy_saved(&saved, target, &spool).await?;
        title = title.or(saved.title.clone());
        remove_scratch_copy(&saved.saved_dir, &spool).await;
    }
    Ok(title.unwrap_or_else(|| "Artifact".to_string()))
}

/// Removes the private files right away. The empty session around them goes in
/// `retention`'s sweep, because a helper that's still running may reuse it.
async fn remove_scratch_copy(saved_dir: &FsPath, spool: &FsPath) {
    if !saved_dir.starts_with(spool) {
        return;
    }
    if let Err(error) = tokio::fs::remove_dir_all(saved_dir).await {
        tracing::debug!(error = %error, "could not remove artifact scratch copy");
    }
}

async fn read_meta(dir: &FsPath) -> Option<PreviewMeta> {
    let bytes = tokio::fs::read(dir.join(META_FILE)).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// A meta file's time is the version's last open; see `retention`.
async fn record_open(dir: &FsPath, meta: &PreviewMeta) {
    let written = match serde_json::to_vec(meta) {
        Ok(bytes) => tokio::fs::write(dir.join(META_FILE), bytes).await,
        Err(error) => Err(error.into()),
    };
    if let Err(error) = written {
        tracing::debug!(error = %error, "could not record artifact open");
    }
}

async fn prune_other_versions(slug_dir: &FsPath, keep: &str) {
    let Ok(mut entries) = tokio::fs::read_dir(slug_dir).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.file_name() != keep
            && let Err(error) = tokio::fs::remove_dir_all(entry.path()).await
        {
            tracing::debug!(error = %error, "could not remove old artifact version");
        }
    }
}

/// Moves the finished download into place. Losing a race to another download of the
/// same version is fine: its copy is identical, so this one is dropped.
async fn publish_version(temp: &FsPath, version_dir: &FsPath) -> Result<(), AdapterError> {
    if let Some(parent) = version_dir.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let Err(error) = tokio::fs::rename(temp, version_dir).await else {
        return Ok(());
    };
    if version_dir.is_dir() {
        tokio::fs::remove_dir_all(temp).await?;
        return Ok(());
    }
    Err(error.into())
}

/// Downloads the current version of `url` if needed. `None` means it can only be
/// viewed on claude.ai.
pub(super) async fn prepare(
    binary: &str,
    path: &mainframe_runtime::ResolvedPath,
    data_dir: &FsPath,
    slug: &str,
    url: &str,
) -> Result<Option<ReadyPreview>, AdapterError> {
    let cache = cache_root(data_dir);
    tokio::fs::create_dir_all(&cache).await?;
    let mut client = ArtifactClient::start(binary, path, &cache).await?;
    let listing = client.list(url).await?;
    let version = listing.version.clone();
    if safe_relative(&version).is_none_or(|relative| relative.components().count() != 1) {
        return Err(AdapterError::Message(format!(
            "unsafe artifact version: {version}"
        )));
    }
    let target = version_dir(data_dir, slug, &version);
    if let Some(meta) = read_meta(&target).await {
        record_open(&target, &meta).await;
        return Ok(Some(ReadyPreview {
            version,
            title: meta.title,
        }));
    }
    let Some(paths) = files_to_download(&listing) else {
        return Ok(None);
    };

    let title = store_download(&mut client, url, &paths, &cache, &target).await?;
    if let Some(slug_dir) = target.parent() {
        prune_other_versions(slug_dir, &version).await;
    }
    Ok(Some(ReadyPreview { version, title }))
}

/// Fills a temp folder and renames it to `target`, removing it on failure.
async fn store_download(
    client: &mut ArtifactClient,
    url: &str,
    paths: &[String],
    cache: &FsPath,
    target: &FsPath,
) -> Result<String, AdapterError> {
    let download_id = NEXT_DOWNLOAD.fetch_add(1, Ordering::Relaxed);
    let temp = cache.join(format!(
        "{DOWNLOAD_PREFIX}{}-{download_id}",
        std::process::id()
    ));
    tokio::fs::create_dir_all(&temp).await?;
    let stored = fill_temp(client, url, paths, &temp).await;
    let published = match stored {
        Ok(title) => publish_version(&temp, target).await.map(|()| title),
        Err(error) => Err(error),
    };
    if published.is_err()
        && let Err(error) = tokio::fs::remove_dir_all(&temp).await
    {
        tracing::debug!(error = %error, "could not remove failed artifact download");
    }
    published
}

async fn fill_temp(
    client: &mut ArtifactClient,
    url: &str,
    paths: &[String],
    temp: &FsPath,
) -> Result<String, AdapterError> {
    let title = download(client, url, paths, temp).await?;
    let meta = PreviewMeta {
        title: title.clone(),
    };
    tokio::fs::write(temp.join(META_FILE), serde_json::to_vec(&meta)?).await?;
    Ok(title)
}

#[cfg(test)]
#[path = "cache_tests.rs"]
mod tests;
