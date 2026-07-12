//! Webhook trigger primitives (T8.3, Node triggers/webhook.ts): HMAC-SHA256
//! signature verification in GitHub's fixed `sha256=<lowercase-hex>` form,
//! preset match predicates, replay-dedup delivery ids, and the A7 staleness
//! window. Pure — the ingest pipeline (webhook_ingest.rs) sequences these
//! and the route (T9.3) maps its decisions onto HTTP statuses.

use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;

use crate::credentials::{CredentialError, CredentialKind, CredentialStore, Credentials};
use crate::domain::WebhookPreset;

/// A7: deliveries older than this are dropped when a timestamp is
/// derivable; without one, the permanent delivery-id unique-index dedup is
/// the replay defense (stronger than any window for ids already seen).
const STALE_WINDOW_MS: i64 = 10 * 60 * 1000;

/// Timing-safe HMAC-SHA256 check over the RAW request body. The signature
/// encoding is fixed as `sha256=<lowercase-hex>` (contract §4 — Node
/// compares the string forms, so uppercase hex must not verify here either);
/// the caller passes whichever of `X-Signature`/`X-Hub-Signature-256` it
/// found — this is header-name agnostic.
pub fn verify_signature(secret: &str, raw_body: &[u8], header: Option<&str>) -> bool {
    let Some(header) = header else {
        return false;
    };
    let Some(hex_part) = header.strip_prefix("sha256=") else {
        return false;
    };
    if hex_part.bytes().any(|b| b.is_ascii_uppercase()) {
        return false;
    }
    let Ok(given) = hex::decode(hex_part) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(raw_body);
    // verify_slice is constant-time (subtle under the hood).
    mac.verify_slice(&given).is_ok()
}

/// A preset's server-side match predicate (contract §4), evaluated after
/// the signature and before starting a run — without it a `pull_request`
/// delivery fires on every label/sync edit.
pub struct WebhookPresetPredicate {
    pub event: &'static str,
    pub action: Option<&'static str>,
    pub merged: Option<bool>,
}

pub fn preset_predicate(preset: WebhookPreset) -> WebhookPresetPredicate {
    match preset {
        WebhookPreset::GithubPrOpened => WebhookPresetPredicate {
            event: "pull_request",
            action: Some("opened"),
            merged: None,
        },
        WebhookPreset::GithubPrMerged => WebhookPresetPredicate {
            event: "pull_request",
            action: Some("closed"),
            merged: Some(true),
        },
    }
}

/// The ingest pipeline merges `X-GitHub-Event` into the payload under
/// `event` before calling this; `merged` checks the nested
/// `pull_request.merged` field GitHub actually sends on `closed`.
pub fn match_preset(predicate: &WebhookPresetPredicate, payload: &Value) -> bool {
    let Some(body) = payload.as_object() else {
        return false;
    };
    if body.get("event").and_then(Value::as_str) != Some(predicate.event) {
        return false;
    }
    if let Some(action) = predicate.action
        && body.get("action").and_then(Value::as_str) != Some(action)
    {
        return false;
    }
    if let Some(merged) = predicate.merged {
        let actual = body
            .get("pull_request")
            .and_then(|pr| pr.get("merged"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if actual != merged {
            return false;
        }
    }
    true
}

/// Replay-dedup key (contract §4): `X-GitHub-Delivery` first, else a
/// required `id` payload field. `None` = malformed delivery (route → 400),
/// never a silent no-dedup pass.
pub fn delivery_id(payload: &Value, github_delivery: Option<&str>) -> Option<String> {
    if let Some(header) = github_delivery
        && !header.is_empty()
    {
        return Some(header.to_string());
    }
    match payload.get("id") {
        Some(Value::String(id)) if !id.is_empty() => Some(id.clone()),
        Some(Value::Number(id)) => Some(id.to_string()),
        _ => None,
    }
}

/// A delivery's client-asserted send time, when the sender provides one
/// (A7's bounded window applies only where a timestamp is derivable —
/// GitHub's `X-GitHub-Delivery` is an id, not a clock). Accepts an
/// `X-Timestamp` header or a top-level `timestamp` payload field as unix
/// seconds, unix milliseconds, or an ISO-8601 string.
pub fn delivery_timestamp_ms(payload: &Value, x_timestamp: Option<&str>) -> Option<i64> {
    if let Some(from_header) = x_timestamp.and_then(parse_timestamp) {
        return Some(from_header);
    }
    match payload.get("timestamp") {
        Some(Value::Number(n)) => n.as_f64().map(normalize_epoch),
        Some(Value::String(s)) => parse_timestamp(s),
        _ => None,
    }
}

fn parse_timestamp(value: &str) -> Option<i64> {
    if value.is_empty() {
        return None;
    }
    if let Ok(numeric) = value.parse::<f64>() {
        if !numeric.is_finite() {
            return None;
        }
        return Some(normalize_epoch(numeric));
    }
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// Bare epochs below 1e12 are unix *seconds* (Stripe/Slack's convention) —
/// a millisecond timestamp is always well above it for any date this app
/// will see.
fn normalize_epoch(value: f64) -> i64 {
    if value < 1e12 {
        (value * 1000.0) as i64
    } else {
        value as i64
    }
}

/// A7's 10-minute bounded staleness window.
pub fn is_stale_delivery(timestamp_ms: i64, now_ms: i64) -> bool {
    now_ms - timestamp_ms > STALE_WINDOW_MS
}

/// Generates and persists the `webhook:<hookId>` signing secret once
/// (Node ensureWebhookSecret) — the service calls this when arming a
/// webhook trigger; an existing secret is left alone so rotating requires
/// an explicit delete.
pub async fn ensure_webhook_secret(
    credentials: &dyn CredentialStore,
    hook_id: &str,
) -> Result<(), CredentialError> {
    let label = format!("webhook:{hook_id}");
    if credentials.get(&label).await.is_some() {
        return Ok(());
    }
    let mut bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut bytes);
    credentials
        .set(
            &label,
            Credentials {
                kind: CredentialKind::Token,
                token: hex::encode(bytes),
                extra: None,
            },
        )
        .await
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T8.3), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node triggers/webhook.ts; sample capture is in-memory in
//        webhook_ingest.rs (R3) instead of Node's trigger_state column.
