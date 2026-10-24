use std::path::{Path, PathBuf};
use std::sync::Arc;

use mainframe_acp::resume::persisted::PreparedHistoryTail;
use mainframe_chat::HistoryValidation;
use mainframe_runtime::sync::KeyedMutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::AsyncReadExt as _;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

#[derive(Serialize, Deserialize)]
pub(super) struct Manifest {
    pub version: u32,
    pub generation: String,
    pub chat_id: String,
    pub window: Value,
    pub previews: bool,
    pub validation: HistoryValidation,
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    generation: String,
    tail: PreparedHistoryTail,
}

pub(crate) struct TailStore {
    directory: PathBuf,
    locks: KeyedMutex,
    writers: Arc<Semaphore>,
}

impl TailStore {
    pub(super) fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            locks: KeyedMutex::default(),
            writers: Arc::new(Semaphore::new(2)),
        }
    }

    pub(super) async fn manifest(&self, chat_id: &str) -> Option<Manifest> {
        if !valid_id(chat_id) {
            return None;
        }
        let manifest: Manifest = read_json(&self.path(chat_id, "meta"), 128 * 1024).await?;
        (manifest.version == 1 && manifest.chat_id == chat_id).then_some(manifest)
    }

    pub(super) async fn tail(&self, manifest: &Manifest) -> Option<PreparedHistoryTail> {
        let envelope: Envelope =
            read_json(&self.path(&manifest.chat_id, "tail"), 8 * 1024 * 1024).await?;
        (envelope.generation == manifest.generation).then_some(envelope.tail)
    }

    pub(super) fn writer(&self) -> Option<OwnedSemaphorePermit> {
        self.writers.clone().try_acquire_owned().ok()
    }

    pub(super) async fn write(
        &self,
        manifest: Manifest,
        tail: PreparedHistoryTail,
        _permit: OwnedSemaphorePermit,
    ) {
        if !valid_id(&manifest.chat_id) {
            return;
        }
        let _guard = self.locks.acquire(&manifest.chat_id).await;
        let chat_id = manifest.chat_id.clone();
        let envelope = Envelope {
            generation: manifest.generation.clone(),
            tail,
        };
        if let Err(error) = self.write_pair(&manifest, envelope).await {
            tracing::warn!(%chat_id, error = %error, "persisted transcript tail write failed");
        }
        prune(&self.directory).await;
    }

    async fn write_pair(&self, manifest: &Manifest, envelope: Envelope) -> std::io::Result<()> {
        let data = tokio::task::spawn_blocking(move || serde_json::to_vec(&envelope))
            .await
            .map_err(|error| std::io::Error::other(error.to_string()))??;
        let meta = serde_json::to_vec(manifest)?;
        if data.len() > 8 * 1024 * 1024 || meta.len() > 128 * 1024 {
            return Ok(());
        }
        tokio::fs::create_dir_all(&self.directory).await?;
        let tail_path = self.path(&manifest.chat_id, "tail");
        mainframe_runtime::fs::write_atomic(&tail_path, &data, false)
            .await
            .map_err(std::io::Error::other)?;
        if let Err(error) =
            mainframe_runtime::fs::write_atomic(&self.path(&manifest.chat_id, "meta"), &meta, false)
                .await
        {
            if let Err(cleanup) = tokio::fs::remove_file(tail_path).await
                && cleanup.kind() != std::io::ErrorKind::NotFound
            {
                tracing::warn!(chat_id = manifest.chat_id, error = %cleanup, "transcript tail cleanup failed");
            }
            return Err(std::io::Error::other(error));
        }
        Ok(())
    }

    fn path(&self, chat_id: &str, kind: &str) -> PathBuf {
        self.directory.join(format!("{chat_id}.{kind}.json"))
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

async fn read_json<T: serde::de::DeserializeOwned + Send + 'static>(
    path: &Path,
    limit: u64,
) -> Option<T> {
    if tokio::fs::metadata(path).await.ok()?.len() > limit {
        return None;
    }
    let file = tokio::fs::File::open(path).await.ok()?;
    let mut data = Vec::new();
    file.take(limit + 1).read_to_end(&mut data).await.ok()?;
    if data.len() as u64 > limit {
        return None;
    }
    tokio::task::spawn_blocking(move || serde_json::from_slice(&data))
        .await
        .ok()?
        .ok()
}

async fn prune(directory: &Path) {
    let Ok(mut entries) = tokio::fs::read_dir(directory).await else {
        return;
    };
    let mut manifests = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(id) = name.strip_suffix(".meta.json")
            && valid_id(id)
            && let Ok(metadata) = entry.metadata().await
            && let Ok(modified) = metadata.modified()
        {
            manifests.push((modified, id.to_owned()));
        }
    }
    manifests.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    for (_, id) in manifests.into_iter().skip(200) {
        for kind in ["meta", "tail"] {
            if let Err(error) =
                tokio::fs::remove_file(directory.join(format!("{id}.{kind}.json"))).await
            {
                tracing::warn!(chat_id = id, error = %error, "persisted transcript tail pruning failed");
            }
        }
    }
}
