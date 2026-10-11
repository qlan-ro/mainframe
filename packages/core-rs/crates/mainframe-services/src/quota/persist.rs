//! Write-behind persistence for quota blobs. `QuotaManager::ingest` is
//! synchronous (adapter event sinks call it), so it cannot await the settings
//! store; instead every write joins one ordered queue drained by a single task,
//! so the last blob ingested for a key is always the last one written.

use std::sync::{Arc, Mutex};

use mainframe_types::settings_kv::SettingsKv;
use mainframe_types::sync::LockExt as _;
use tokio::sync::mpsc;

use super::manager::QUOTA_CATEGORY;

enum PersistJob {
    Write {
        key: String,
        value: String,
    },
    #[cfg(test)]
    Flush(tokio::sync::oneshot::Sender<()>),
}

type Writer = (mpsc::UnboundedReceiver<PersistJob>, Arc<dyn SettingsKv>);

pub(super) struct QuotaPersister {
    tx: mpsc::UnboundedSender<PersistJob>,
    /// The writer task's inputs until it is spawned: at boot from
    /// `QuotaManager::load_from_disk`, or on the first write if that runs
    /// earlier (the manager can be built before a runtime exists).
    writer: Mutex<Option<Writer>>,
}

impl QuotaPersister {
    pub(super) fn new(settings: Arc<dyn SettingsKv>) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        Self {
            tx,
            writer: Mutex::new(Some((rx, settings))),
        }
    }

    /// Queue `value` for `quota.<key>`.
    pub(super) fn persist(&self, key: &str, value: String) {
        self.enqueue(PersistJob::Write {
            key: key.to_string(),
            value,
        });
    }

    /// Resolves once every write queued before the call has been attempted.
    #[cfg(test)]
    pub(super) async fn flush(&self) {
        let (done, wait) = tokio::sync::oneshot::channel();
        self.enqueue(PersistJob::Flush(done));
        if wait.await.is_err() {
            tracing::warn!("quota persistence writer stopped before the flush");
        }
    }

    fn enqueue(&self, job: PersistJob) {
        self.start_writer();
        if self.tx.send(job).is_err() {
            tracing::warn!("quota persistence writer stopped; blob not saved");
        }
    }

    /// Spawn the writer task on the current runtime if it is not running yet.
    pub(super) fn start_writer(&self) {
        let mut writer = self.writer.lock_recover();
        if writer.is_none() {
            return;
        }
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                if let Some((rx, settings)) = writer.take() {
                    handle.spawn(drain(rx, settings));
                }
            }
            Err(err) => {
                tracing::warn!(error = %err, "no async runtime yet; quota blob stays queued");
            }
        }
    }
}

async fn drain(mut rx: mpsc::UnboundedReceiver<PersistJob>, settings: Arc<dyn SettingsKv>) {
    while let Some(job) = rx.recv().await {
        match job {
            PersistJob::Write { key, value } => {
                if let Err(err) = settings.set(QUOTA_CATEGORY, &key, &value).await {
                    tracing::warn!(error = %err, category = QUOTA_CATEGORY, key = %key, "failed to persist quota blob");
                }
            }
            #[cfg(test)]
            PersistJob::Flush(done) => {
                let _ = done.send(()); // expected: the flushing caller may have gone away
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::test_support::FailingSettings;
    use mainframe_types::settings_kv::MemorySettings;

    #[tokio::test]
    async fn writes_land_in_queue_order_so_the_last_value_wins() {
        let settings = Arc::new(MemorySettings::default());
        let persister = QuotaPersister::new(settings.clone());
        for n in 0..50 {
            persister.persist("claude:uuid-1", format!("blob-{n}"));
        }
        persister.persist("codex:openai-1", "other".to_string());
        persister.flush().await;
        assert_eq!(
            settings.get("quota", "claude:uuid-1").await.unwrap(),
            Some("blob-49".to_string())
        );
        assert_eq!(
            settings.get("quota", "codex:openai-1").await.unwrap(),
            Some("other".to_string())
        );
    }

    #[test]
    fn writes_queued_before_a_runtime_exists_land_once_one_does() {
        let settings = Arc::new(MemorySettings::default());
        let persister = QuotaPersister::new(settings.clone());
        persister.persist("claude:uuid-1", "early".to_string());
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        rt.block_on(async {
            persister.flush().await;
            assert_eq!(
                settings.get("quota", "claude:uuid-1").await.unwrap(),
                Some("early".to_string())
            );
        });
    }

    #[tokio::test]
    async fn a_failed_write_does_not_stop_the_queue() {
        let persister = QuotaPersister::new(Arc::new(FailingSettings));
        persister.persist("claude:uuid-1", "lost".to_string());
        persister.flush().await;
        persister.persist("claude:uuid-1", "also lost".to_string());
        persister.flush().await;
    }
}
