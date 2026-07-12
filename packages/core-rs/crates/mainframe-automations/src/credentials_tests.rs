//! T6.1 — FileCredentialStore: set/get/delete/labels, 0600 perms, atomic
//! temp+rename persistence, unreadable-file fallback, Debug redaction.

use std::collections::BTreeMap;

use tempfile::tempdir;

use crate::credentials::{CredentialKind, CredentialStore, Credentials, FileCredentialStore};

fn token_creds(token: &str) -> Credentials {
    Credentials {
        kind: CredentialKind::Token,
        token: token.to_string(),
        extra: None,
    }
}

#[tokio::test]
async fn set_get_delete_labels_round_trip() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("automation-credentials.json");
    let store = FileCredentialStore::load(path).await;

    assert_eq!(store.get("github").await, None);
    assert!(store.labels().await.is_empty());

    store
        .set("github", token_creds("ghp_secret"))
        .await
        .unwrap();
    store
        .set("notion", token_creds("ntn_secret"))
        .await
        .unwrap();

    assert_eq!(store.get("github").await, Some(token_creds("ghp_secret")));
    assert_eq!(store.labels().await, vec!["github", "notion"]);

    store.delete("github").await.unwrap();
    assert_eq!(store.get("github").await, None);
    assert_eq!(store.labels().await, vec!["notion"]);
}

#[tokio::test]
async fn persists_across_reload_in_node_compatible_shape() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("automation-credentials.json");

    let store = FileCredentialStore::load(path.clone()).await;
    let creds = Credentials {
        kind: CredentialKind::Token,
        token: "tok_1".to_string(),
        extra: Some(BTreeMap::from([(
            "organization".to_string(),
            "qlan".to_string(),
        )])),
    };
    store.set("ado", creds.clone()).await.unwrap();
    drop(store);

    // Node's FileCredentialStore reads the same file: a label→Credentials
    // record with kind:"token" (both daemons share <dataDir>).
    let raw: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(raw["ado"]["kind"], "token");
    assert_eq!(raw["ado"]["token"], "tok_1");
    assert_eq!(raw["ado"]["extra"]["organization"], "qlan");

    let reloaded = FileCredentialStore::load(path).await;
    assert_eq!(reloaded.get("ado").await, Some(creds));
}

#[cfg(unix)]
#[tokio::test]
async fn credential_file_is_mode_0600() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let path = dir.path().join("automation-credentials.json");
    let store = FileCredentialStore::load(path.clone()).await;
    store.set("github", token_creds("s3cret")).await.unwrap();

    let mode = std::fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600, "expected 0600, got {:o}", mode & 0o777);
}

#[tokio::test]
async fn no_stray_temp_file_left_behind() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("automation-credentials.json");
    let store = FileCredentialStore::load(path).await;
    store.set("github", token_creds("s3cret")).await.unwrap();

    let entries: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(entries, vec!["automation-credentials.json"]);
}

#[tokio::test]
async fn unreadable_file_treated_as_empty() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("automation-credentials.json");
    std::fs::write(&path, "{not json").unwrap();

    let store = FileCredentialStore::load(path).await;
    assert!(store.labels().await.is_empty());

    // The store stays usable and the next persist repairs the file.
    store.set("github", token_creds("tok")).await.unwrap();
    assert_eq!(store.get("github").await, Some(token_creds("tok")));
}

#[test]
fn debug_never_prints_secret_material() {
    let creds = Credentials {
        kind: CredentialKind::Token,
        token: "ghp_supersecret".to_string(),
        extra: Some(BTreeMap::from([(
            "password".to_string(),
            "hunter2".to_string(),
        )])),
    };
    let debug = format!("{creds:?}");
    assert!(!debug.contains("ghp_supersecret"), "leaked token: {debug}");
    assert!(!debug.contains("hunter2"), "leaked extra value: {debug}");
    assert!(debug.contains("[redacted]"));
}
