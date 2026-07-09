//! Ported from `src/auth/token.ts`.
//!
//! WIRE-CRITICAL: a device token minted by the Node daemon must validate here
//! and vice versa. The payload string, the HMAC-SHA256 input bytes, and the
//! base64url encoding are reproduced exactly. `payload` is
//! `JSON.stringify({ deviceId, iat, epoch? })` in insertion order; `payloadB64`
//! is base64url(payload utf-8 bytes) *without padding*; `sig` is
//! base64url(HMAC-SHA256(secret, payloadB64 utf-8 bytes)); the token is
//! `"<payloadB64>.<sig>"`.
//! Node's `Buffer.toString('base64url')` emits the URL-safe alphabet with no
//! padding; there is no `base64` crate in the workspace allowlist, so the codec
//! is hand-rolled below (a private helper, not a new dependency).

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Mirrors `TokenPayload` in `src/auth/token.ts`. Field order (deviceId, iat,
/// epoch) matches the JS object literal so `serde_json` reproduces the exact
/// `JSON.stringify` bytes that get signed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPayload {
    pub device_id: String,
    pub iat: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epoch: Option<i64>,
}

/// Mirrors `generateToken(secret, deviceId, epoch?)`.
pub fn generate_token(secret: &str, device_id: &str, epoch: Option<i64>) -> String {
    let payload = TokenPayload {
        device_id: device_id.to_string(),
        iat: chrono::Utc::now().timestamp_millis(),
        epoch,
    };
    // JSON.stringify(payload); serialization of a plain struct cannot fail.
    let payload_json = serde_json::to_string(&payload).unwrap_or_default();
    let payload_b64 = base64url::encode(payload_json.as_bytes());
    let sig = sign(secret, payload_b64.as_bytes());
    format!("{payload_b64}.{sig}")
}

/// Mirrors `validateToken(secret, token)`.
pub fn validate_token(secret: &str, token: &str) -> Option<TokenPayload> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 2 {
        return None;
    }

    let payload_b64 = parts[0];
    let sig = parts[1];
    let expected_sig = sign(secret, payload_b64.as_bytes());

    // Mirrors the length-check + timingSafeEqual guard: compare the base64url
    // signature strings in constant time, bailing on a length mismatch first.
    if !constant_time_eq(expected_sig.as_bytes(), sig.as_bytes()) {
        return None;
    }

    // JSON.parse(base64url-decode(payloadB64)); any failure -> null.
    let decoded = base64url::decode(payload_b64)?;
    serde_json::from_slice(&decoded).ok()
}

/// Mirrors `generatePairingCode()`: a 6-char code over `[A-Z0-9]`.
pub fn generate_pairing_code() -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let bytes: [u8; 6] = rand::random();
    bytes
        .iter()
        .map(|b| CHARS[(*b as usize) % CHARS.len()] as char)
        .collect()
}

/// `createHmac('sha256', secret).update(data).digest('base64url')`.
fn sign(secret: &str, data: &[u8]) -> String {
    // `Hmac::new_from_slice` only errors on invalid key length, which HMAC never
    // rejects (any length is valid); the Err arm is unreachable in practice.
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(mac) => mac,
        Err(_) => return String::new(),
    };
    mac.update(data);
    base64url::encode(&mac.finalize().into_bytes())
}

/// Length-checked constant-time byte comparison, matching Node's
/// `timingSafeEqual` (which requires equal lengths) preceded by the explicit
/// length guard in `validateToken`.
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
mod tests {
    use super::*;

    const SECRET: &str = "test-secret-key-at-least-32-chars-long!!";

    // --- ported vitest assertions (token.test.ts) ---

    #[test]
    fn generates_a_valid_jwt_that_can_be_validated() {
        let token = generate_token(SECRET, "mobile-device-1", None);
        let payload = validate_token(SECRET, &token);
        assert!(payload.is_some());
        assert_eq!(payload.unwrap().device_id, "mobile-device-1");
    }

    #[test]
    fn rejects_an_invalid_token() {
        assert!(validate_token(SECRET, "garbage-token").is_none());
    }

    #[test]
    fn rejects_a_token_signed_with_a_different_secret() {
        let token = generate_token("other-secret-that-is-also-32-chars!!", "device", None);
        assert!(validate_token(SECRET, &token).is_none());
    }

    #[test]
    fn generates_a_6_character_alphanumeric_pairing_code() {
        let code = generate_pairing_code();
        assert_eq!(code.len(), 6);
        assert!(
            code.chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        );
    }

    #[test]
    fn embeds_epoch_in_the_payload_when_provided() {
        let token = generate_token("test-secret", "mobile-1", Some(7));
        let payload = validate_token("test-secret", &token);
        assert!(payload.is_some());
        assert_eq!(payload.unwrap().epoch, Some(7));
    }

    #[test]
    fn omits_epoch_when_not_provided() {
        let token = generate_token("test-secret", "mobile-1", None);
        let payload = validate_token("test-secret", &token);
        assert!(payload.is_some());
        assert_eq!(payload.unwrap().epoch, None);
    }

    // --- cross-implementation wire-compatibility vectors ---
    // Generated by the Node `src/auth/token.ts` algorithm (createHmac + base64url)
    // so these prove a Node-minted token validates in Rust byte-for-byte.

    /// secret="test-secret", deviceId="mobile-1", iat=1700000000000, epoch=7
    const NODE_TOKEN_A: &str = "eyJkZXZpY2VJZCI6Im1vYmlsZS0xIiwiaWF0IjoxNzAwMDAwMDAwMDAwLCJlcG9jaCI6N30.261W9M57u5JV0LARFlS3Idhv4OaQyIKWGUKR7Xx4J48";
    /// secret="test-secret-key-at-least-32-chars-long!!", deviceId="mobile-device-1", iat=1700000000000
    const NODE_TOKEN_B: &str = "eyJkZXZpY2VJZCI6Im1vYmlsZS1kZXZpY2UtMSIsImlhdCI6MTcwMDAwMDAwMDAwMH0.hvO3RE5FUWf8GmF4jVPpUUrd6o0vQTBAECoQzSFndAw";

    #[test]
    fn validates_a_node_minted_token_with_epoch() {
        let payload =
            validate_token("test-secret", NODE_TOKEN_A).expect("node token A must validate");
        assert_eq!(payload.device_id, "mobile-1");
        assert_eq!(payload.iat, 1700000000000);
        assert_eq!(payload.epoch, Some(7));
    }

    #[test]
    fn validates_a_node_minted_token_without_epoch() {
        let payload = validate_token(SECRET, NODE_TOKEN_B).expect("node token B must validate");
        assert_eq!(payload.device_id, "mobile-device-1");
        assert_eq!(payload.iat, 1700000000000);
        assert_eq!(payload.epoch, None);
    }

    #[test]
    fn node_token_rejected_under_wrong_secret() {
        assert!(validate_token("wrong-secret", NODE_TOKEN_A).is_none());
    }

    #[test]
    fn payload_serialization_matches_node_json_stringify() {
        // JSON.stringify({deviceId, iat, epoch}) — exact bytes, insertion order.
        let payload = TokenPayload {
            device_id: "mobile-1".into(),
            iat: 1700000000000,
            epoch: Some(7),
        };
        assert_eq!(
            serde_json::to_string(&payload).unwrap(),
            r#"{"deviceId":"mobile-1","iat":1700000000000,"epoch":7}"#
        );
    }

    #[test]
    fn base64url_matches_node_buffer_output() {
        // Buffer.from('hello world').toString('base64url')
        assert_eq!(base64url::encode(b"hello world"), "aGVsbG8gd29ybGQ");
        // Buffer.from(JSON.stringify(payloadA)).toString('base64url')
        let payload_json = r#"{"deviceId":"mobile-1","iat":1700000000000,"epoch":7}"#;
        assert_eq!(
            base64url::encode(payload_json.as_bytes()),
            "eyJkZXZpY2VJZCI6Im1vYmlsZS0xIiwiaWF0IjoxNzAwMDAwMDAwMDAwLCJlcG9jaCI6N30"
        );
    }

    #[test]
    fn base64url_round_trips() {
        for input in [
            b"".as_slice(),
            b"a",
            b"ab",
            b"abc",
            b"abcd",
            &[0u8, 255, 128, 1],
        ] {
            let encoded = base64url::encode(input);
            assert_eq!(base64url::decode(&encoded).unwrap(), input);
        }
    }

    #[test]
    fn rust_token_matches_node_signature_construction() {
        // A Rust-minted token's signature is base64url(HMAC(secret, payloadB64)) —
        // identical to Node's, so Node validates Rust-minted tokens by construction.
        let token = generate_token("test-secret", "mobile-1", Some(7));
        let (payload_b64, sig) = token.split_once('.').unwrap();
        assert_eq!(sig, super::sign("test-secret", payload_b64.as_bytes()));
    }
}

// PORT STATUS: src/auth/token.ts (39 lines)
// confidence: high
// todos: 0
// notes: WIRE-VERIFIED against Node vectors (createHmac + base64url) hardcoded in
// tests — Node-minted tokens validate here; Rust-minted signatures reproduce
// Node's construction. base64url is hand-rolled (no `base64` crate in the
// allowlist) and vector-checked against Buffer.toString('base64url'). iat uses
// Utc::now().timestamp_millis() (== Date.now()). timingSafeEqual maps to a
// length-checked constant-time compare. `sign` returns "" on the unreachable
// HMAC InvalidLength arm (no unwrap/expect outside tests).
