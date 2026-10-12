//! WIRE-CRITICAL: a device token minted by an earlier daemon release must validate here
//! and vice versa. The payload string, the HMAC-SHA256 input bytes, and the
//! base64url encoding are reproduced exactly. `payload` is
//! `JSON.stringify({ deviceId, iat, epoch? })` in insertion order; `payloadB64`
//! is base64url(payload utf-8 bytes) *without padding*; `sig` is
//! base64url(HMAC-SHA256(secret, payloadB64 utf-8 bytes)); the token is
//! `"<payloadB64>.<sig>"`.
//! base64url is the URL-safe alphabet with no
//! padding; there is no `base64` crate in the workspace allowlist, so the codec
//! is hand-rolled below (a private helper, not a new dependency).

use serde::{Deserialize, Serialize};

/// The signed token payload. Field order (deviceId, iat, epoch) is fixed so
/// `serde_json` reproduces the exact `JSON.stringify` bytes that get signed.
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
    let payload_b64 = base64url::encode(payload_json.as_bytes());
    let sig = sign(secret, payload_b64.as_bytes());
    format!("{payload_b64}.{sig}")
}

/// Mirrors `validateToken(secret, token)`.
pub(crate) fn validate_token(secret: &str, token: &str) -> Option<TokenPayload> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 2 {
        return None;
    }

    let payload_b64 = parts[0];
    let sig = parts[1];
    let expected_sig = sign(secret, payload_b64.as_bytes());

    // Compare the base64url signature strings in constant time, bailing on a
    // length mismatch first.
    if !constant_time_eq(expected_sig.as_bytes(), sig.as_bytes()) {
        return None;
    }

    // Decode and parse the payload; any failure yields `None`.
    let decoded = base64url::decode(payload_b64)?;
    serde_json::from_slice(&decoded).ok()
}

/// A 6-char pairing code over `[A-Z0-9]`.
pub fn generate_pairing_code() -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let bytes: [u8; 6] = rand::random();
    bytes
        .iter()
        .map(|b| CHARS[(*b as usize) % CHARS.len()] as char)
        .collect()
}

/// base64url(HMAC-SHA256(secret, data)).
fn sign(secret: &str, data: &[u8]) -> String {
    super::hmac::sign_sha256(secret.as_bytes(), data)
        .map(|signature| base64url::encode(&signature))
        .unwrap_or_default()
}

/// Length-checked constant-time byte comparison: unequal lengths fail fast,
/// equal lengths are compared without an early exit.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// URL-safe base64 without padding — the encoding `Buffer.toString('base64url')`
/// produces and `Buffer.from(str, 'base64url')` consumes.
mod base64url {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    pub fn encode(input: &[u8]) -> String {
        let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
        for chunk in input.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
            let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
            let n = (b0 << 16) | (b1 << 8) | b2;
            out.push(ALPHABET[((n >> 18) & 0x3f) as usize] as char);
            out.push(ALPHABET[((n >> 12) & 0x3f) as usize] as char);
            if chunk.len() > 1 {
                out.push(ALPHABET[((n >> 6) & 0x3f) as usize] as char);
            }
            if chunk.len() > 2 {
                out.push(ALPHABET[(n & 0x3f) as usize] as char);
            }
        }
        out
    }

    pub fn decode(input: &str) -> Option<Vec<u8>> {
        let mut out = Vec::with_capacity(input.len() * 3 / 4);
        let mut buf = 0u32;
        let mut bits = 0u32;
        for &c in input.as_bytes() {
            let v = match c {
                b'A'..=b'Z' => c - b'A',
                b'a'..=b'z' => c - b'a' + 26,
                b'0'..=b'9' => c - b'0' + 52,
                b'-' => 62,
                b'_' => 63,
                _ => return None,
            };
            buf = (buf << 6) | v as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
            }
        }
        Some(out)
    }
}

#[cfg(test)]
#[path = "token_tests.rs"]
mod tests;
