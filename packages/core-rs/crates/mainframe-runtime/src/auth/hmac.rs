use hmac::{Hmac, Mac};
use sha2::Sha256;

pub fn sign_sha256(secret: &[u8], data: &[u8]) -> Option<[u8; 32]> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).ok()?;
    mac.update(data);
    Some(mac.finalize().into_bytes().into())
}

pub fn verify_sha256(secret: &[u8], data: &[u8], signature: &[u8]) -> bool {
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret) else {
        return false;
    };
    mac.update(data);
    mac.verify_slice(signature).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_and_verifies_literal_sha256_vector() {
        let signature = sign_sha256(b"key", b"body").unwrap();
        assert_eq!(
            hex::encode(signature),
            "515aae133b435d4000956731f68ae5cf5eb85d4f0dc6a546d2bfcd3595ec1ae1"
        );
        assert!(verify_sha256(b"key", b"body", &signature));
        assert!(!verify_sha256(b"key", b"other", &signature));
    }
}
