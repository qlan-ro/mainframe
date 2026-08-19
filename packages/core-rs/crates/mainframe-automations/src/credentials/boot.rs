//! Boot-time credential-store selection (2026-08-19 provider-connections
//! plan, Deliverable 1): prefer the OS keychain, fall back to the legacy
//! plaintext file when the keychain is unusable (headless Linux, no
//! secret-service running), and migrate an existing plaintext file into the
//! keychain the first time it becomes available — a one-shot move rather
//! than a permanent read-through, so a working keychain never leaves a live
//! copy of a secret sitting on disk after boot.
//!
//! Migrating at boot (not lazily on a per-label miss) means the plaintext
//! file is gone as soon as possible rather than lingering for the life of
//! the process; a partial failure just leaves it in place so the next boot
//! retries the labels that didn't make it across.

use std::path::Path;
use std::sync::Arc;

use super::keyring_store::{KeyringBackend, KeyringCredentialStore, SystemKeyringBackend};
use super::{CredentialStore, FileCredentialStore};

const LABELS_INDEX_FILE: &str = "automation-credentials-labels.json";
const LEGACY_FILE: &str = "automation-credentials.json";
const PROBE_LABEL: &str = "__mainframe_probe__";

/// Chooses and builds the store a daemon runs with for the rest of its
/// life, logging which backend won exactly once.
pub async fn build_credential_store(data_dir: &Path) -> Arc<dyn CredentialStore> {
    build_with_backend(data_dir, SystemKeyringBackend::new()).await
}

pub(super) async fn build_with_backend<B: KeyringBackend + 'static>(
    data_dir: &Path,
    backend: B,
) -> Arc<dyn CredentialStore> {
    let legacy_path = data_dir.join(LEGACY_FILE);
    match probe(&backend) {
        Ok(()) => {
            let store =
                KeyringCredentialStore::load(backend, data_dir.join(LABELS_INDEX_FILE)).await;
            migrate_legacy_file(&store, &legacy_path).await;
            tracing::info!("automation credentials: OS keychain backend active");
            Arc::new(store)
        }
        Err(err) => {
            tracing::warn!(
                error = %err,
                "automation credentials: OS keychain unavailable, falling back to the \
                 0600 plaintext file store"
            );
            Arc::new(FileCredentialStore::load(legacy_path).await)
        }
    }
}

/// A cheap round trip on a throwaway label — the only reliable way to learn
/// whether the keychain backend actually works on this machine before
/// committing to it for the whole process lifetime.
fn probe<B: KeyringBackend>(backend: &B) -> Result<(), String> {
    backend.set(PROBE_LABEL, "probe")?;
    backend.delete(PROBE_LABEL)
}

/// Reads every label out of the legacy file, writes each into the keychain,
/// and removes the plaintext file only once every write succeeded.
async fn migrate_legacy_file<B: KeyringBackend + 'static>(
    store: &KeyringCredentialStore<B>,
    legacy_path: &Path,
) {
    let legacy = FileCredentialStore::load(legacy_path.to_path_buf()).await;
    let labels = legacy.labels().await;
    if labels.is_empty() {
        return;
    }

    let mut migrated = 0usize;
    for label in &labels {
        let Some(creds) = legacy.get(label).await else {
            continue;
        };
        match store.set(label, creds).await {
            Ok(()) => migrated += 1,
            Err(err) => tracing::error!(
                label,
                error = %err,
                "failed to migrate a stored credential into the keychain; leaving \
                 the plaintext file in place for the next boot to retry"
            ),
        }
    }

    if migrated != labels.len() {
        return;
    }
    match tokio::fs::remove_file(legacy_path).await {
        Ok(()) => tracing::info!(
            count = migrated,
            "migrated stored credentials from the plaintext file into the OS keychain"
        ),
        Err(err) => tracing::warn!(
            error = %err,
            "migrated credentials into the keychain but could not remove the old plaintext file"
        ),
    }
}

// PORT STATUS: greenfield (2026-08-19 automations-provider-connections plan, Deliverable 1)
// confidence: high
// todos: 0
// notes: build_with_backend is the generic seam boot_tests.rs drives with a
//        fake backend, so no test in this crate ever touches the real OS
//        keychain (see keyring_store_tests.rs for why the crate's own mock
//        can't do this instead).
