//! `RefreshingCredentialStore` over wiremock (`notion_ado_tests.rs`-style):
//! refresh-near-expiry, the stampede lock, refresh failure, and the PAT
//! passthrough that must stay untouched.

use std::sync::Arc;

use chrono::{DateTime, FixedOffset};
use tempfile::tempdir;
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::credentials::{CredentialKind, CredentialStore, Credentials, FileCredentialStore};
use crate::ports::Clock;

use super::RefreshingCredentialStore;

const NOW_MS: i64 = 1_700_000_000_000;

struct FixedClock(i64);

impl Clock for FixedClock {
    fn now(&self) -> DateTime<FixedOffset> {
        DateTime::from_timestamp_millis(self.0)
            .expect("valid instant")
            .fixed_offset()
    }
}

async fn inner_store_with(label: &str, creds: Credentials) -> Arc<FileCredentialStore> {
    let dir = tempdir().unwrap();
    let store = Arc::new(FileCredentialStore::load(dir.path().join("creds.json")).await);
    store.set(label, creds).await.unwrap();
    store
}

fn expiring_soon(refresh_token: &str) -> Credentials {
    Credentials {
        kind: CredentialKind::Token,
        token: "ghu_stale".to_string(),
        extra: None,
        refresh_token: Some(refresh_token.to_string()),
        // One minute out — inside the 5-minute skew window.
        expires_at: Some(NOW_MS + 60_000),
    }
}

fn pat_with_no_expiry() -> Credentials {
    Credentials {
        kind: CredentialKind::Token,
        token: "ghp_pasted".to_string(),
        extra: None,
        refresh_token: None,
        expires_at: None,
    }
}

#[tokio::test]
async fn refreshes_a_credential_expiring_within_the_skew_window() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .and(body_string_contains("grant_type=refresh_token"))
        .and(body_string_contains("refresh_token=old-refresh"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "ghu_fresh",
            "refresh_token": "ghr_fresh",
            "expires_in": 28800,
        })))
        .expect(1)
        .mount(&server)
        .await;
    let inner = inner_store_with("github", expiring_soon("old-refresh")).await;
    let store = RefreshingCredentialStore::with_token_url(
        inner.clone(),
        Arc::new(FixedClock(NOW_MS)),
        format!("{}/token", server.uri()),
        "test-client",
    );

    let refreshed = store.get("github").await.unwrap().unwrap();

    assert_eq!(refreshed.token, "ghu_fresh");
    assert_eq!(refreshed.refresh_token, Some("ghr_fresh".to_string()));
    assert_eq!(refreshed.expires_at, Some(NOW_MS + 28_800_000));
    // Persisted through the inner store, not just returned.
    assert_eq!(inner.get("github").await.unwrap().token, "ghu_fresh");
}

#[tokio::test]
async fn concurrent_get_refreshes_exactly_once() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token": "ghu_fresh",
            "refresh_token": "ghr_fresh",
            "expires_in": 28800,
        })))
        .expect(1)
        .mount(&server)
        .await;
    let inner = inner_store_with("github", expiring_soon("old-refresh")).await;
    let store = Arc::new(RefreshingCredentialStore::with_token_url(
        inner,
        Arc::new(FixedClock(NOW_MS)),
        format!("{}/token", server.uri()),
        "test-client",
    ));

    let tasks: Vec<_> = (0..5)
        .map(|_| {
            let store = store.clone();
            tokio::spawn(async move { store.get("github").await.unwrap().unwrap().token })
        })
        .collect();
    let mut results = Vec::new();
    for task in tasks {
        results.push(task.await.unwrap());
    }

    assert!(results.iter().all(|token| token == "ghu_fresh"));
    // `.expect(1)` above is verified when `server` drops at the end of this
    // test — without the per-label lock, all 5 tasks would refresh
    // concurrently and this assertion (and the mock's expectation) would fail.
}

#[tokio::test]
async fn refresh_failure_produces_an_actionable_error_naming_the_credential() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "error": "bad_refresh_token",
            "error_description": "The refresh token passed is incorrect or expired.",
        })))
        .mount(&server)
        .await;
    let inner = inner_store_with("github", expiring_soon("old-refresh")).await;
    let store = RefreshingCredentialStore::with_token_url(
        inner,
        Arc::new(FixedClock(NOW_MS)),
        format!("{}/token", server.uri()),
        "test-client",
    );

    let err = store.get("github").await.unwrap_err();

    assert_eq!(
        err.to_string(),
        "credential 'github' expired and refresh failed: The refresh token passed is incorrect or expired. — reconnect GitHub in Settings"
    );
}

#[tokio::test]
async fn a_pat_with_no_expiry_never_attempts_refresh() {
    let server = MockServer::start().await;
    // No mock mounted — a request here would panic wiremock's unhandled-call guard.
    let inner = inner_store_with("github", pat_with_no_expiry()).await;
    let store = RefreshingCredentialStore::with_token_url(
        inner,
        Arc::new(FixedClock(NOW_MS)),
        format!("{}/token", server.uri()),
        "test-client",
    );

    let creds = store.get("github").await.unwrap().unwrap();

    assert_eq!(creds.token, "ghp_pasted");
}

#[tokio::test]
async fn a_credential_expiring_well_outside_the_skew_window_is_left_alone() {
    let server = MockServer::start().await;
    // No mock mounted — refreshing this far ahead of expiry would be a bug.
    let mut creds = expiring_soon("old-refresh");
    creds.expires_at = Some(NOW_MS + 60 * 60 * 1000); // one hour out
    let inner = inner_store_with("github", creds).await;
    let store = RefreshingCredentialStore::with_token_url(
        inner,
        Arc::new(FixedClock(NOW_MS)),
        format!("{}/token", server.uri()),
        "test-client",
    );

    let result = store.get("github").await.unwrap().unwrap();

    assert_eq!(result.token, "ghu_stale");
}

#[tokio::test]
async fn a_missing_label_returns_none_without_attempting_refresh() {
    let server = MockServer::start().await;
    let dir = tempdir().unwrap();
    let inner = Arc::new(FileCredentialStore::load(dir.path().join("creds.json")).await);
    let store = RefreshingCredentialStore::with_token_url(
        inner,
        Arc::new(FixedClock(NOW_MS)),
        format!("{}/token", server.uri()),
        "test-client",
    );

    assert_eq!(store.get("github").await.unwrap(), None);
}
