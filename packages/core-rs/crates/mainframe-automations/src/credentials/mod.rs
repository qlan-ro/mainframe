//! Credential storage (T6.1, extended by the 2026-08-19
//! provider-connections plan). `CredentialStore` is the contract every
//! caller depends on; `FileCredentialStore` (plaintext JSON at 0600) is the
//! original impl and stays as the fallback for headless Linux or a keychain
//! that isn't reachable. `keyring_store` adds the OS-keychain-backed impl
//! the plan asked for; `boot::build_credential_store` is where a daemon
//! picks between them (logs the choice, migrates an existing plaintext file
//! into the keychain the first time it becomes available). Node is deleted
//! (c470bb1f) — there is no second reader of this file, so the on-disk shape
//! is this crate's alone to evolve. Secrets never enter template scope or
//! step I/O.

use std::collections::BTreeMap;
use std::fmt;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::engine::BoxFuture;

mod boot;
mod keyring_store;

pub use boot::build_credential_store;

#[cfg(test)]
mod boot_tests;
#[cfg(test)]
mod keyring_store_tests;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub kind: CredentialKind,
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialKind {
    Token,
}

/// Manual Debug: `token` and `extra` values are secret material and must not
/// reach logs or error messages (plan T6.1).
impl fmt::Debug for Credentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Credentials")
            .field("kind", &self.kind)
            .field("token", &"[redacted]")
            .field(
                "extra",
                &self.extra.as_ref().map(|e| {
                    e.keys()
                        .map(|k| (k.as_str(), "[redacted]"))
                        .collect::<BTreeMap<_, _>>()
                }),
            )
            .finish()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CredentialError {
    #[error("credential store write failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("credential store serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("keychain store failed: {0}")]
    Keyring(String),
}

pub trait CredentialStore: Send + Sync {
    fn get<'a>(&'a self, label: &'a str) -> BoxFuture<'a, Option<Credentials>>;
    fn set<'a>(
        &'a self,
        label: &'a str,
        creds: Credentials,
    ) -> BoxFuture<'a, Result<(), CredentialError>>;
    fn delete<'a>(&'a self, label: &'a str) -> BoxFuture<'a, Result<(), CredentialError>>;
    fn labels(&self) -> BoxFuture<'_, Vec<String>>;
}

pub struct FileCredentialStore {
    path: PathBuf,
    cache: RwLock<BTreeMap<String, Credentials>>,
}

impl FileCredentialStore {
    /// Reads the file once at construction; a missing file is a fresh store,
    /// an unreadable/malformed one logs and starts empty (Node parity — the
    /// next persist repairs it).
    pub async fn load(path: PathBuf) -> Self {
        let cache = match tokio::fs::read(&path).await {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(map) => map,
                Err(err) => {
                    tracing::error!(
                        err = %err,
                        file_path = %path.display(),
                        "credential store unreadable; treating as empty"
                    );
                    BTreeMap::new()
                }
            },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(err) => {
                tracing::error!(
                    err = %err,
                    file_path = %path.display(),
                    "credential store unreadable; treating as empty"
                );
                BTreeMap::new()
            }
        };
        Self {
            path,
            cache: RwLock::new(cache),
        }
    }

    /// Serializes under the write lock (writers stay ordered), then writes a
    /// nanoid-suffixed sibling and renames over the real file — atomic even
    /// against the Node daemon writing the same path.
    async fn persist(&self, cache: &BTreeMap<String, Credentials>) -> Result<(), CredentialError> {
        let json = serde_json::to_string_pretty(cache)?;
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let file_name = self
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "automation-credentials.json".to_string());
        let tmp = self
            .path
            .with_file_name(format!("{file_name}.tmp-{}", nanoid::nanoid!(8)));
        tokio::fs::write(&tmp, json).await?;
        set_owner_only(&tmp).await?;
        tokio::fs::rename(&tmp, &self.path).await?;
        Ok(())
    }
}

#[cfg(unix)]
async fn set_owner_only(path: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await
}

#[cfg(not(unix))]
async fn set_owner_only(_path: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}

impl CredentialStore for FileCredentialStore {
    fn get<'a>(&'a self, label: &'a str) -> BoxFuture<'a, Option<Credentials>> {
        Box::pin(async move { self.cache.read().await.get(label).cloned() })
    }

    fn set<'a>(
        &'a self,
        label: &'a str,
        creds: Credentials,
    ) -> BoxFuture<'a, Result<(), CredentialError>> {
        Box::pin(async move {
            let mut cache = self.cache.write().await;
            cache.insert(label.to_string(), creds);
            self.persist(&cache).await
        })
    }

    fn delete<'a>(&'a self, label: &'a str) -> BoxFuture<'a, Result<(), CredentialError>> {
        Box::pin(async move {
            let mut cache = self.cache.write().await;
            cache.remove(label);
            self.persist(&cache).await
        })
    }

    fn labels(&self) -> BoxFuture<'_, Vec<String>> {
        Box::pin(async move { self.cache.read().await.keys().cloned().collect() })
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T6.1;
// keyring backend + migration is the 2026-08-19 provider-connections plan), not a TS port
// confidence: high
// todos: 0
// notes: FileCredentialStore is now the fallback store, not the only one —
//        see keyring_store.rs (OS-keychain impl) and boot.rs (which one a
//        daemon boots with, and the file→keychain migration).
