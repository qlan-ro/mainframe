use super::*;

const SECRET: &str = "test-secret-key-at-least-32-chars-long!!";

// --- generate/validate behaviour ---

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
// Minted by an earlier daemon release (HMAC-SHA256 + base64url), so these
// prove a token already held by a paired device validates byte-for-byte.

/// secret="test-secret", deviceId="mobile-1", iat=1700000000000, epoch=7
const NODE_TOKEN_A: &str = "eyJkZXZpY2VJZCI6Im1vYmlsZS0xIiwiaWF0IjoxNzAwMDAwMDAwMDAwLCJlcG9jaCI6N30.261W9M57u5JV0LARFlS3Idhv4OaQyIKWGUKR7Xx4J48";
/// secret="test-secret-key-at-least-32-chars-long!!", deviceId="mobile-device-1", iat=1700000000000
const NODE_TOKEN_B: &str = "eyJkZXZpY2VJZCI6Im1vYmlsZS1kZXZpY2UtMSIsImlhdCI6MTcwMDAwMDAwMDAwMH0.hvO3RE5FUWf8GmF4jVPpUUrd6o0vQTBAECoQzSFndAw";

#[test]
fn validates_a_node_minted_token_with_epoch() {
    let payload = validate_token("test-secret", NODE_TOKEN_A).expect("node token A must validate");
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
    // A minted token's signature is base64url(HMAC(secret, payloadB64)), the
    // construction the wire-compatibility vectors above were minted with.
    let token = generate_token("test-secret", "mobile-1", Some(7));
    let (payload_b64, sig) = token.split_once('.').unwrap();
    assert_eq!(sig, super::sign("test-secret", payload_b64.as_bytes()));
}
