//! `KeyringCredentialStore` behind a hand-rolled `FakeKeyringBackend` — see
//! the module doc for why `keyring`'s own mock can't stand in here.

use std::collections::BTreeMap;
use std::sync::Mutex;

use super::keyring_store::{KeyringBackend, KeyringCredentialStore};
use super::{CredentialKind, CredentialStore, Credentials};

#[derive(Default)]
struct FakeKeyringBackend {
    secrets: Mutex<BTreeMap<String, String>>,
    get_calls: Mutex<Vec<String>>,
}

impl KeyringBackend for FakeKeyringBackend {
    fn get(&self, label: &str) -> Result<Option<String>, String> {
        self.get_calls.lock().unwrap().push(label.to_string());
        Ok(self.secrets.lock().unwrap().get(label).cloned())
    }

    fn set(&self, label: &str, secret: &str) -> Result<(), String> {
        self.secrets
            .lock()
            .unwrap()
            .insert(label.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, label: &str) -> Result<(), String> {
        self.secrets.lock().unwrap().remove(label);
        Ok(())
    }
}

fn creds(token: &str) -> Credentials {
    Credentials {
        kind: CredentialKind::Token,
        token: token.to_string(),
        extra: None,
        refresh_token: None,
        expires_at: None,
    }
}

#[tokio::test]
async fn set_then_get_round_trips_through_the_backend() {
    let dir = tempfile::tempdir().unwrap();
    let store =
        KeyringCredentialStore::load(FakeKeyringBackend::default(), dir.path().join("l.json"))
            .await;

    store.set("github", creds("ghp_1")).await.unwrap();

    assert_eq!(
        store.get("github").await.map(|c| c.token),
        Some("ghp_1".to_string())
    );
    assert_eq!(store.labels().await, vec!["github".to_string()]);
}

#[tokio::test]
async fn an_unindexed_label_reads_none_without_touching_the_backend() {
    let dir = tempfile::tempdir().unwrap();
    let backend = FakeKeyringBackend::default();
    let store = KeyringCredentialStore::load(backend, dir.path().join("l.json")).await;

    assert_eq!(store.get("notion").await, None);
    // A miss must be answered from the label index alone, never a real
    // keychain round trip for a label nothing ever stored.
    assert!(store.backend().get_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delete_removes_the_secret_and_the_label() {
    let dir = tempfile::tempdir().unwrap();
    let store =
        KeyringCredentialStore::load(FakeKeyringBackend::default(), dir.path().join("l.json"))
            .await;
    store.set("ado", creds("pat")).await.unwrap();

    store.delete("ado").await.unwrap();

    assert_eq!(store.get("ado").await, None);
    assert!(store.labels().await.is_empty());
}

#[tokio::test]
async fn the_label_index_survives_a_reload_from_disk() {
    let dir = tempfile::tempdir().unwrap();
    let index_path = dir.path().join("l.json");
    let store =
        KeyringCredentialStore::load(FakeKeyringBackend::default(), index_path.clone()).await;
    store.set("notion", creds("secret")).await.unwrap();

    // A fresh backend on reload — only the index (never a secret) is
    // expected to persist across this store's own restart in this test;
    // the real OS keychain owns persisting the secret itself.
    let reloaded = KeyringCredentialStore::load(FakeKeyringBackend::default(), index_path).await;

    assert_eq!(reloaded.labels().await, vec!["notion".to_string()]);
}
