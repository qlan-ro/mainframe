use std::collections::BTreeMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};

use mainframe_adapter_api::HistoryDependency;
use mainframe_runtime::sync::KeyedMutex;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Header {
    source: HistoryDependency,
    session_id: Option<String>,
}

#[derive(Default, PartialEq, Eq, Serialize, Deserialize)]
struct Index {
    version: u32,
    directory: PathBuf,
    files: BTreeMap<String, Header>,
    order: Vec<String>,
}

pub(crate) struct HistorySourceIndex {
    directory: PathBuf,
    locks: KeyedMutex,
    #[cfg(test)]
    header_reads: std::sync::atomic::AtomicUsize,
}

impl HistorySourceIndex {
    pub(crate) fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            locks: KeyedMutex::default(),
            #[cfg(test)]
            header_reads: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    pub(crate) async fn related_files(
        &self,
        directory: &Path,
        session: &str,
    ) -> Option<Vec<String>> {
        let directory = tokio::fs::canonicalize(directory).await.ok()?;
        let mut hash = DefaultHasher::new();
        directory.hash(&mut hash);
        let key = format!("{:016x}", hash.finish());
        let _guard = self.locks.acquire(&key).await;
        let path = self.directory.join(format!("{key}.json"));
        let previous = read_index(&path, &directory).await;
        let current = self.scan(&directory, &previous).await?;
        let files = current
            .order
            .iter()
            .filter_map(|name| current.files.get(name))
            .filter(|header| header.session_id.as_deref() == Some(session))
            .map(|header| header.source.path.to_string_lossy().into_owned())
            .collect();
        if current != previous
            && let Err(error) = self.save(&path, current).await
        {
            tracing::warn!(error = %error, "history source index write failed");
        }
        Some(files)
    }

    async fn scan(&self, directory: &Path, previous: &Index) -> Option<Index> {
        let before = HistoryDependency::capture(directory.into()).await?;
        let mut entries = tokio::fs::read_dir(directory).await.ok()?;
        let mut files = BTreeMap::new();
        let mut order = Vec::new();
        while let Some(entry) = entries.next_entry().await.ok()? {
            if entry
                .path()
                .extension()
                .is_none_or(|extension| extension != "jsonl")
            {
                continue;
            }
            if files.len() >= 20_000 {
                return None;
            }
            let name = entry.file_name().into_string().ok()?;
            let source = HistoryDependency::capture(entry.path()).await?;
            let header = match previous.files.get(&name) {
                Some(header) if header.source == source => header.clone(),
                _ => {
                    let session_id = self.read_header(&source.path).await?;
                    if !source.is_current().await {
                        return None;
                    }
                    Header { source, session_id }
                }
            };
            order.push(name.clone());
            files.insert(name, header);
        }
        if !before.is_current().await {
            return None;
        }
        Some(Index {
            version: 1,
            directory: directory.into(),
            files,
            order,
        })
    }

    async fn read_header(&self, path: &Path) -> Option<Option<String>> {
        #[cfg(test)]
        self.header_reads
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut lines = BufReader::new(tokio::fs::File::open(path).await.ok()?).lines();
        while let Some(line) = lines.next_line().await.ok()? {
            if line.trim().is_empty() {
                continue;
            }
            #[derive(Deserialize)]
            struct SessionHeader {
                #[serde(rename = "sessionId")]
                session_id: Option<String>,
            }
            return Some(
                serde_json::from_str::<SessionHeader>(&line)
                    .ok()
                    .and_then(|header| header.session_id),
            );
        }
        Some(None)
    }

    async fn save(&self, path: &Path, index: Index) -> Result<(), std::io::Error> {
        tokio::fs::create_dir_all(&self.directory).await?;
        let bytes = tokio::task::spawn_blocking(move || serde_json::to_vec(&index))
            .await
            .map_err(|error| std::io::Error::other(error.to_string()))??;
        mainframe_runtime::fs::write_atomic(path, &bytes, false)
            .await
            .map_err(std::io::Error::other)?;
        prune(&self.directory).await;
        Ok(())
    }
}

async fn read_index(path: &Path, directory: &Path) -> Index {
    if let Ok(metadata) = tokio::fs::metadata(path).await
        && metadata.len() <= 8 * 1024 * 1024
        && let Ok(bytes) = tokio::fs::read(path).await
        && let Ok(Ok(index)) =
            tokio::task::spawn_blocking(move || serde_json::from_slice::<Index>(&bytes)).await
        && index.version == 1
        && index.directory == directory
    {
        return index;
    }
    Index::default()
}

async fn prune(directory: &Path) {
    let Ok(mut entries) = tokio::fs::read_dir(directory).await else {
        return;
    };
    let mut files = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry
            .path()
            .extension()
            .is_none_or(|extension| extension != "json")
        {
            continue;
        }
        if let Ok(metadata) = entry.metadata().await
            && let Ok(modified) = metadata.modified()
        {
            files.push((modified, entry.path()));
        }
    }
    files.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    for (_, path) in files.into_iter().skip(200) {
        if let Err(error) = tokio::fs::remove_file(path).await {
            tracing::warn!(error = %error, "history source index pruning failed");
        }
    }
}

#[cfg(test)]
#[path = "history_source_index_tests.rs"]
mod tests;
