//! `build_credential_store`'s keychain-vs-file decision and the
//! plaintext-file migration, driven through `build_with_backend` so no test
//! here touches the real OS keychain (see `keyring_store_tests.rs` for why
//! `keyring`'s own mock can't stand in for that).

use std::collections::BTreeMap;
use std::sync::Mutex;

use super::keyring_store::KeyringBackend;
use super::{CredentialKind, CredentialStore, Credentials, FileCredentialStore};

#[derive(Default)]
struct FakeKeyringBackend {
    secrets: Mutex<BTreeMap<String, String>>,
    fail: bool,
}

impl FakeKeyringBackend {
    fn failing() -> Self {
        Self {
            secrets: Mutex::default(),
            fail: true,
        }
    }
}

impl KeyringBackend for FakeKeyringBackend {
    fn get(&self, label: &str) -> Result<Option<String>, String> {
        if self.fail {
            return Err("keychain unavailable (fake)".to_string());
        }
        Ok(self.secrets.lock().unwrap().get(label).cloned())
    }

    fn set(&self, label: &str, secret: &str) -> Result<(), String> {
        if self.fail {
            return Err("keychain unavailable (fake)".to_string());
        }
        self.secrets
            .lock()
            .unwrap()
            .insert(label.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, label: &str) -> Result<(), String> {
        if self.fail {
            return Err("keychain unavailable (fake)".to_string());
        }
        self.secrets.lock().unwrap().remove(label);
        Ok(())
    }
}

fn creds(token: &str) -> Credentials {
    Credentials {
        kind: CredentialKind::Token,
        token: token.to_string(),
        extra: None,
    }
}

#[tokio::test]
async fn a_usable_keychain_wins_with_nothing_to_migrate() {
    let dir = tempfile::tempdir().unwrap();

    let store = super::boot::build_with_backend(dir.path(), FakeKeyringBackend::default()).await;
    store.set("github", creds("ghp_1")).await.unwrap();

    assert_eq!(
        store.get("github").await.map(|c| c.token),
        Some("ghp_1".to_string())
    );
}

#[tokio::test]
async fn an_unusable_keychain_falls_back_to_the_file_store() {
    let dir = tempfile::tempdir().unwrap();

    let store = super::boot::build_with_backend(dir.path(), FakeKeyringBackend::failing()).await;
    store.set("notion", creds("secret")).await.unwrap();

    // The fallback file store persisted the write; a real daemon restart
    // over the same data dir would see it again.
    let reopened = FileCredentialStore::load(dir.path().join("automation-credentials.json")).await;
    assert_eq!(
        reopened.get("notion").await.map(|c| c.token),
        Some("secret".to_string())
    );
}

#[tokio::test]
async fn an_existing_plaintext_file_migrates_into_a_usable_keychain_and_is_removed() {
    let dir = tempfile::tempdir().unwrap();
    let legacy_path = dir.path().join("automation-credentials.json");
    let legacy = FileCredentialStore::load(legacy_path.clone()).await;
    legacy.set("ado", creds("pat-1")).await.unwrap();
    legacy.set("notion", creds("secret-1")).await.unwrap();

    let store = super::boot::build_with_backend(dir.path(), FakeKeyringBackend::default()).await;

    assert_eq!(
        store.get("ado").await.map(|c| c.token),
        Some("pat-1".to_string())
    );
    assert_eq!(
        store.get("notion").await.map(|c| c.token),
        Some("secret-1".to_string())
    );
    assert!(
        !legacy_path.exists(),
        "the plaintext file must be removed once every credential migrated"
    );
}

#[tokio::test]
async fn a_missing_plaintext_file_is_not_an_error() {
    let dir = tempfile::tempdir().unwrap();

    let store = super::boot::build_with_backend(dir.path(), FakeKeyringBackend::default()).await;

    assert!(store.labels().await.is_empty());
}
