//! OS-keychain-backed `CredentialStore` (2026-08-19 provider-connections
//! plan, Deliverable 1): a pasted PAT belongs in the platform keychain, not
//! a 0600 JSON file. `KeyringBackend` is the seam tests stand in for — the
//! `keyring` crate's own mock module can't fill that role, because its
//! `MockCredentialBuilder::build` ignores `service`/`user` and hands back a
//! fresh, unpersisted `MockCredential` on every `Entry::new` call, and this
//! store opens a fresh `Entry` per operation. A homegrown fake is the only
//! way to assert persistence across `get`/`set`/`delete` without touching
//! (or prompting for) the real OS keychain in tests.

use std::collections::BTreeSet;
use std::path::PathBuf;

use tokio::sync::RwLock;

use crate::engine::BoxFuture;

use super::{CredentialError, CredentialStore, Credentials};

/// One secret slot, addressed by label.
pub(crate) trait KeyringBackend: Send + Sync {
    fn get(&self, label: &str) -> Result<Option<String>, String>;
    fn set(&self, label: &str, secret: &str) -> Result<(), String>;
    /// Deleting an absent label is not an error — `CredentialStore::delete`
    /// on an already-gone label is a no-op for every backend.
    fn delete(&self, label: &str) -> Result<(), String>;
}

/// Its own service namespace, separate from the Tauri shell's
/// `daemons.rs` remote-pairing-token entries — this crate stores
/// automation connector credentials, a different secret class.
const SERVICE: &str = "mainframe-automations";

pub(crate) struct SystemKeyringBackend;

impl SystemKeyringBackend {
    pub(crate) fn new() -> Self {
        Self
    }
}

impl KeyringBackend for SystemKeyringBackend {
    fn get(&self, label: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(SERVICE, label).map_err(|err| err.to_string())?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    }

    fn set(&self, label: &str, secret: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, label).map_err(|err| err.to_string())?;
        entry.set_password(secret).map_err(|err| err.to_string())
    }

    fn delete(&self, label: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, label).map_err(|err| err.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        }
    }
}

/// `CredentialStore` over a `KeyringBackend`. Keychains can't be enumerated
/// cross-platform, so a small label index — just the label strings, the
/// same information `GET /api/automation-credentials` already exposes, never
/// a secret — persists beside it to answer `labels()`.
pub(crate) struct KeyringCredentialStore<B: KeyringBackend> {
    backend: B,
    index_path: PathBuf,
    labels: RwLock<BTreeSet<String>>,
}

impl<B: KeyringBackend> KeyringCredentialStore<B> {
    /// A missing or malformed index starts empty — the same tolerant
    /// boot behavior `FileCredentialStore::load` uses for its own file.
    pub(crate) async fn load(backend: B, index_path: PathBuf) -> Self {
        let labels = match tokio::fs::read(&index_path).await {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(_) => BTreeSet::new(),
        };
        Self {
            backend,
            index_path,
            labels: RwLock::new(labels),
        }
    }

    /// Test-only escape hatch so a test can assert on the backend directly
    /// (e.g. that a miss never reached it) without a public accessor on the
    /// production API.
    #[cfg(test)]
    pub(super) fn backend(&self) -> &B {
        &self.backend
    }

    async fn persist_index(&self, labels: &BTreeSet<String>) -> Result<(), CredentialError> {
        let json = serde_json::to_string_pretty(labels)?;
        if let Some(parent) = self.index_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let file_name = self
            .index_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "automation-credentials-labels.json".to_string());
        let tmp = self
            .index_path
            .with_file_name(format!("{file_name}.tmp-{}", nanoid::nanoid!(8)));
        tokio::fs::write(&tmp, json).await?;
        tokio::fs::rename(&tmp, &self.index_path).await?;
        Ok(())
    }
}

impl<B: KeyringBackend + 'static> CredentialStore for KeyringCredentialStore<B> {
    fn get<'a>(&'a self, label: &'a str) -> BoxFuture<'a, Option<Credentials>> {
        Box::pin(async move {
            if !self.labels.read().await.contains(label) {
                return None;
            }
            match self.backend.get(label) {
                Ok(Some(json)) => serde_json::from_str(&json).ok(),
                Ok(None) => None,
                Err(err) => {
                    tracing::error!(label, error = %err, "keychain credential read failed");
                    None
                }
            }
        })
    }

    fn set<'a>(
        &'a self,
        label: &'a str,
        creds: Credentials,
    ) -> BoxFuture<'a, Result<(), CredentialError>> {
        Box::pin(async move {
            let json = serde_json::to_string(&creds)?;
            self.backend
                .set(label, &json)
                .map_err(CredentialError::Keyring)?;
            let mut labels = self.labels.write().await;
            labels.insert(label.to_string());
            self.persist_index(&labels).await
        })
    }

    fn delete<'a>(&'a self, label: &'a str) -> BoxFuture<'a, Result<(), CredentialError>> {
        Box::pin(async move {
            self.backend
                .delete(label)
                .map_err(CredentialError::Keyring)?;
            let mut labels = self.labels.write().await;
            labels.remove(label);
            self.persist_index(&labels).await
        })
    }

    fn labels(&self) -> BoxFuture<'_, Vec<String>> {
        Box::pin(async move { self.labels.read().await.iter().cloned().collect() })
    }
}

// PORT STATUS: greenfield (2026-08-19 automations-provider-connections plan, Deliverable 1)
// confidence: high
// todos: 0
// notes: the label index is the only non-secret state this store keeps on
//        disk; the actual token round-trips through `KeyringBackend` alone.
