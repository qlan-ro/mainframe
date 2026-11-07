//! WIRE-CRITICAL: a device token minted by an earlier daemon release must keep
//! validating. A token is `"<payload>.<signature>"`: `payload` is the unpadded
//! base64url of the JSON `{"deviceId","iat","epoch"?}` in that order, and
//! `signature` is the unpadded base64url of HMAC-SHA256(secret, `payload` as
//! text).

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::Rng;
use serde::{Deserialize, Serialize};

use super::hmac::{sign_sha256, verify_sha256};

/// The signed token payload. Field order (deviceId, iat, epoch) is fixed so
/// `serde_json` reproduces the exact bytes that get signed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPayload {
    pub device_id: String,
    pub iat: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epoch: Option<i64>,
}

/// Mints a device token for `device_id`, stamped with the current time in ms.
pub fn generate_token(secret: &str, device_id: &str, epoch: Option<i64>) -> String {
    let payload = TokenPayload {
        device_id: device_id.to_string(),
        iat: mainframe_types::time::now_ms(),
        epoch,
    };
    // Serialization of a plain struct cannot fail.
    let payload_json = serde_json::to_string(&payload).unwrap_or_default();
    let payload_b64 = URL_SAFE_NO_PAD.encode(payload_json);
    let sig = sign(secret, payload_b64.as_bytes());
    format!("{payload_b64}.{sig}")
}

/// The verified payload of `token`, or `None` for anything else. `hmac`
/// compares in constant time, and the base64 engine rejects a signature with
/// non-canonical trailing bits, so each signature has exactly one spelling.
pub(crate) fn validate_token(secret: &str, token: &str) -> Option<TokenPayload> {
    let (payload_b64, sig) = token.split_once('.')?;
    let sig = URL_SAFE_NO_PAD.decode(sig).ok()?;
    if !verify_sha256(secret.as_bytes(), payload_b64.as_bytes(), &sig) {
        return None;
    }
    let decoded = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    serde_json::from_slice(&decoded).ok()
}

/// A 6-char pairing code over `[A-Z0-9]`.
pub fn generate_pairing_code() -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

/// base64url(HMAC-SHA256(secret, data)).
fn sign(secret: &str, data: &[u8]) -> String {
    sign_sha256(secret.as_bytes(), data)
        .map(|signature| URL_SAFE_NO_PAD.encode(signature))
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "token_tests.rs"]
mod tests;
