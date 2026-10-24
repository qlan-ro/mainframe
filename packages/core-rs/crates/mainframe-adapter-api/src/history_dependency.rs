use std::path::PathBuf;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryDependency {
    pub path: PathBuf,
    pub len: u64,
    pub modified: SystemTime,
    pub identity: Option<[u64; 4]>,
}

impl HistoryDependency {
    pub async fn capture(path: PathBuf) -> Option<Self> {
        let metadata = tokio::fs::metadata(&path).await.ok()?;
        Some(Self {
            path,
            len: metadata.len(),
            modified: metadata.modified().ok()?,
            identity: identity(&metadata),
        })
    }

    pub async fn is_current(&self) -> bool {
        Self::capture(self.path.clone()).await.as_ref() == Some(self)
    }
}

#[cfg(unix)]
fn identity(metadata: &std::fs::Metadata) -> Option<[u64; 4]> {
    use std::os::unix::fs::MetadataExt;
    Some([
        metadata.dev(),
        metadata.ino(),
        metadata.ctime() as u64,
        metadata.ctime_nsec() as u64,
    ])
}

#[cfg(not(unix))]
fn identity(_: &std::fs::Metadata) -> Option<[u64; 4]> {
    None
}
