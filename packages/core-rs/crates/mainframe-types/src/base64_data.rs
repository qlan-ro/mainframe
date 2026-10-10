use base64::Engine;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};

const LENIENT: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::STANDARD,
    GeneralPurposeConfig::new()
        .with_encode_padding(false)
        .with_decode_padding_mode(DecodePaddingMode::Indifferent)
        .with_decode_allow_trailing_bits(true),
);

/// Node Buffer's standard, padded base64 output.
pub fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// The attachment decoder's historical behavior: ignore non-standard alphabet
/// bytes, stop at the first `=`, and accept missing padding.
pub fn decode_lenient(input: &str) -> Vec<u8> {
    let mut filtered = Vec::with_capacity(input.len());
    for byte in input.bytes() {
        if byte == b'=' {
            break;
        }
        if byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/') {
            filtered.push(byte);
        }
    }
    if filtered.len() % 4 == 1 {
        filtered.pop();
    }
    LENIENT.decode(filtered).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{decode_lenient, encode};

    #[test]
    fn node_base64_shape_and_lenient_attachment_inputs() {
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(decode_lenient("Zg"), b"f");
        assert_eq!(decode_lenient(" Z!m9v==ignored"), b"foo");
        assert_eq!(decode_lenient("Zg_-"), b"f");
        assert_eq!(decode_lenient("Z"), b"");
        assert_eq!(decode_lenient("Zh"), b"f");
    }
}
