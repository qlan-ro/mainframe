//! Keeps artifact downloads from piling up.
//!
//! The cache holds private artifact content in plain files, so anything not opened
//! for a while goes, and a size cap bounds the rest. Re-opening one just downloads
//! it again. The helper's own scratch sessions go too: the CLI leaves one behind per
//! run, keyed by the helper's working directory, so chat sessions are never in reach.

use std::path::{Path as FsPath, PathBuf};
use std::time::{Duration, SystemTime};

use mainframe_background_tasks::encoding::encode_cwd_segment;
use mainframe_background_tasks::spool_root::spool_root;

use super::cache::{DOWNLOAD_PREFIX, META_FILE};

const MAX_IDLE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const MAX_CACHE_BYTES: u64 = 500 * 1024 * 1024;
/// Longer than any download, so a running helper's folder is never touched.
const STALE_AFTER: Duration = Duration::from_secs(60 * 60);

#[derive(Debug)]
struct CachedArtifact {
    dir: PathBuf,
    last_opened: SystemTime,
    bytes: u64,
}

/// Which artifacts to drop, oldest first: anything idle too long, then whatever
/// keeps the cache over its cap. The artifact just opened always stays.
fn to_evict(
    mut artifacts: Vec<CachedArtifact>,
    now: SystemTime,
    opened: &FsPath,
    max_bytes: u64,
) -> Vec<PathBuf> {
    artifacts.sort_by_key(|artifact| artifact.last_opened);
    let mut total: u64 = artifacts.iter().map(|artifact| artifact.bytes).sum();
    let mut evicted = Vec::new();
    for artifact in artifacts {
        if artifact.dir == opened {
            continue;
        }
        let idle = now
            .duration_since(artifact.last_opened)
            .is_ok_and(|age| age > MAX_IDLE);
        if idle || total > max_bytes {
            total = total.saturating_sub(artifact.bytes);
            evicted.push(artifact.dir);
        }
    }
    evicted
}

fn is_stale(modified: SystemTime, now: SystemTime) -> bool {
    now.duration_since(modified)
        .is_ok_and(|age| age > STALE_AFTER)
}

async fn modified(path: &FsPath) -> Option<SystemTime> {
    tokio::fs::metadata(path).await.ok()?.modified().ok()
}

async fn children(dir: &FsPath) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return paths;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        paths.push(entry.path());
    }
    paths
}

async fn size_of(dir: &FsPath) -> u64 {
    let mut pending = vec![dir.to_path_buf()];
    let mut bytes = 0;
    while let Some(next) = pending.pop() {
        for path in children(&next).await {
            match tokio::fs::symlink_metadata(&path).await {
                Ok(metadata) if metadata.is_dir() => pending.push(path),
                Ok(metadata) => bytes += metadata.len(),
                Err(_) => {}
            }
        }
    }
    bytes
}

/// Opening an artifact rewrites its version's meta file, so that file's time is the
/// last open. A folder with none was never finished, so its own time stands in.
async fn last_opened(artifact_dir: &FsPath) -> Option<SystemTime> {
    let mut latest = None;
    for version in children(artifact_dir).await {
        latest = latest.max(modified(&version.join(META_FILE)).await);
    }
    match latest {
        Some(time) => Some(time),
        None => modified(artifact_dir).await,
    }
}

async fn remove(path: &FsPath) {
    if let Err(error) = tokio::fs::remove_dir_all(path).await {
        tracing::debug!(error = %error, "could not remove artifact data");
    }
}

fn is_download(path: &FsPath) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(DOWNLOAD_PREFIX))
}

async fn tidy_cache(cache: &FsPath, opened: &FsPath, now: SystemTime, max_bytes: u64) {
    let mut artifacts = Vec::new();
    for path in children(cache).await {
        if is_download(&path) {
            if modified(&path)
                .await
                .is_some_and(|time| is_stale(time, now))
            {
                remove(&path).await;
            }
            continue;
        }
        if let Some(last_opened) = last_opened(&path).await {
            let bytes = size_of(&path).await;
            artifacts.push(CachedArtifact {
                dir: path,
                last_opened,
                bytes,
            });
        }
    }
    for dir in to_evict(artifacts, now, opened, max_bytes) {
        remove(&dir).await;
    }
}

async fn sweep_scratch(sessions: &FsPath, now: SystemTime) {
    for session in children(sessions).await {
        if modified(&session)
            .await
            .is_some_and(|time| is_stale(time, now))
        {
            remove(&session).await;
        }
    }
}

/// The folder holding the helper's scratch sessions, inside the CLI's spool.
async fn helper_sessions(cache: &FsPath, spool: &FsPath) -> Option<PathBuf> {
    let cwd = tokio::fs::canonicalize(cache).await.ok()?;
    let spool = tokio::fs::canonicalize(spool).await.ok()?;
    Some(spool.join(encode_cwd_segment(&cwd.to_string_lossy())))
}

/// Best-effort housekeeping after an open of the artifact stored at `opened`.
pub(super) async fn tidy(cache: &FsPath, opened: &FsPath) {
    let now = SystemTime::now();
    tidy_cache(cache, opened, now, MAX_CACHE_BYTES).await;
    if let Some(sessions) = helper_sessions(cache, &spool_root()).await {
        sweep_scratch(&sessions, now).await;
    }
}

#[cfg(test)]
#[path = "retention_tests.rs"]
mod tests;
