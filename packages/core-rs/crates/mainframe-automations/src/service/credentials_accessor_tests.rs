//! Task 5a — `AutomationsEngine::credentials()` must hand out the *same*
//! store instance the engine writes through (the link dialog's
//! `set_credential` flow), not a fresh read of the file. A boot-time
//! snapshot would answer `get("github")` with `None` forever on a fresh
//! install, since the cache is loaded once at construction.

use crate::credentials::{CredentialKind, Credentials};

use super::service_tests::engine;

#[tokio::test]
async fn credentials_accessor_sees_writes_made_through_the_engine_instance() {
    let (engine, _sink, _dir) = engine().await;

    let store = engine.credentials();
    assert_eq!(store.get("github").await, None);

    store
        .set(
            "github",
            Credentials {
                kind: CredentialKind::Token,
                token: "ghp_test".to_string(),
                extra: None,
            },
        )
        .await
        .unwrap();

    // The same accessor call must observe the write — proving it is not a
    // second store built from a stale on-disk snapshot.
    assert_eq!(
        engine.credentials().get("github").await.map(|c| c.token),
        Some("ghp_test".to_string())
    );
}
