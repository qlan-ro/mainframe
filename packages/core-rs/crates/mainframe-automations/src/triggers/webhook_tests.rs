//! T8.3 — webhook primitives: `sha256=<lowercase-hex>` HMAC verification
//! (timing-safe, uppercase rejected), preset predicates, delivery ids, the
//! A7 staleness window, and one-time secret provisioning.

use hmac::{Hmac, Mac};
use serde_json::json;
use sha2::Sha256;

use crate::credentials::{CredentialStore, FileCredentialStore};
use crate::domain::WebhookPreset;

use super::webhook::{
    delivery_id, delivery_timestamp_ms, ensure_webhook_secret, is_stale_delivery, match_preset,
    preset_predicate, verify_signature,
};

pub(crate) fn sign(secret: &str, body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

#[test]
fn signature_verifies_the_exact_lowercase_hex_form_only() {
    let body = br#"{"action":"opened"}"#;
    let good = sign("s3cret", body);

    assert!(verify_signature("s3cret", body, Some(&good)));
    assert!(
        !verify_signature("other", body, Some(&good)),
        "wrong secret"
    );
    assert!(
        !verify_signature("s3cret", b"tampered", Some(&good)),
        "body mismatch"
    );
    assert!(!verify_signature("s3cret", body, None), "missing header");
    assert!(
        !verify_signature("s3cret", body, Some(good.trim_start_matches("sha256="))),
        "prefix required"
    );
    assert!(
        !verify_signature("s3cret", body, Some(&good.to_uppercase())),
        "uppercase hex is not the fixed form"
    );
    assert!(
        !verify_signature("s3cret", body, Some("sha256=zz")),
        "garbled hex"
    );
}

#[test]
fn preset_predicates_match_the_contract_examples() {
    let opened = preset_predicate(WebhookPreset::GithubPrOpened);
    assert!(match_preset(
        &opened,
        &json!({"event": "pull_request", "action": "opened"})
    ));
    assert!(
        !match_preset(
            &opened,
            &json!({"event": "pull_request", "action": "synchronize"})
        ),
        "label/sync edits must not fire PR-opened"
    );
    assert!(!match_preset(&opened, &json!({"event": "push"})));

    let merged = preset_predicate(WebhookPreset::GithubPrMerged);
    assert!(match_preset(
        &merged,
        &json!({
            "event": "pull_request",
            "action": "closed",
            "pull_request": {"merged": true},
        })
    ));
    assert!(
        !match_preset(
            &merged,
            &json!({
                "event": "pull_request",
                "action": "closed",
                "pull_request": {"merged": false},
            })
        ),
        "closed-without-merge must not fire PR-merged"
    );
    assert!(!match_preset(&merged, &json!("not an object")));
}

#[test]
fn delivery_id_prefers_the_github_header_then_requires_payload_id() {
    assert_eq!(
        delivery_id(&json!({"id": "fallback"}), Some("gh-123")),
        Some("gh-123".to_string())
    );
    assert_eq!(
        delivery_id(&json!({"id": "evt_9"}), None),
        Some("evt_9".to_string())
    );
    assert_eq!(
        delivery_id(&json!({"id": 42}), None),
        Some("42".to_string())
    );
    assert_eq!(delivery_id(&json!({}), None), None, "id is required");
    assert_eq!(delivery_id(&json!({"id": ""}), Some("")), None);
}

#[test]
fn delivery_timestamps_parse_seconds_millis_and_iso() {
    let now_ms = 1_800_000_000_000_i64; // ~2027, unambiguously millis

    // X-Timestamp header, unix seconds.
    let ts = delivery_timestamp_ms(&json!({}), Some("1800000000")).unwrap();
    assert_eq!(ts, 1_800_000_000_000);
    // Header wins over the payload field.
    let ts = delivery_timestamp_ms(&json!({"timestamp": 1}), Some("1800000000")).unwrap();
    assert_eq!(ts, 1_800_000_000_000);
    // Payload millis.
    let ts = delivery_timestamp_ms(&json!({"timestamp": now_ms}), None).unwrap();
    assert_eq!(ts, now_ms);
    // ISO-8601 string (2027-01-15T08:00:00Z is exactly unix 1800000000).
    let ts = delivery_timestamp_ms(&json!({"timestamp": "2027-01-15T08:00:00Z"}), None).unwrap();
    assert_eq!(ts, 1_800_000_000_000);
    // Absent → None: the permanent delivery-id dedup is the replay defense.
    assert_eq!(delivery_timestamp_ms(&json!({}), None), None);
    assert_eq!(
        delivery_timestamp_ms(&json!({"timestamp": "junk"}), None),
        None
    );
}

#[test]
fn staleness_is_a_ten_minute_window() {
    let now = 1_800_000_000_000_i64;
    assert!(!is_stale_delivery(now, now));
    assert!(
        !is_stale_delivery(now - 10 * 60_000, now),
        "exactly 10m is fresh"
    );
    assert!(is_stale_delivery(now - 10 * 60_000 - 1, now));
    assert!(
        !is_stale_delivery(now + 60_000, now),
        "future skew tolerated"
    );
}

#[tokio::test]
async fn ensure_webhook_secret_provisions_once_under_the_reserved_label() {
    let dir = tempfile::tempdir().unwrap();
    let store = FileCredentialStore::load(dir.path().join("automation-credentials.json")).await;

    ensure_webhook_secret(&store, "hook-1").await.unwrap();
    let first = store.get("webhook:hook-1").await.unwrap();
    assert_eq!(first.token.len(), 64, "32 random bytes, hex-encoded");
    assert!(first.token.bytes().all(|b| b.is_ascii_hexdigit()));

    // Idempotent: an existing secret is left alone (rotation = explicit delete).
    ensure_webhook_secret(&store, "hook-1").await.unwrap();
    assert_eq!(
        store.get("webhook:hook-1").await.unwrap().token,
        first.token
    );
}
