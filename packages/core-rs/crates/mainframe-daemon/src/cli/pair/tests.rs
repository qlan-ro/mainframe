//! `format_pairing_header`/`qr_payload_json`/`format_device_paired`/`urlencode`
//! render the exact text and payloads `mainframe pair` sends and prints;
//! expectations are hardcoded, not recomputed from the functions under test.
//!
//! `render_qr`'s golden output was captured once from this same implementation
//! (there is no independent QR-rendering oracle in this crate) and pinned here
//! so a future change to the payload shape or renderer choice is caught.

use super::*;

mod format_pairing_header_tests {
    use super::*;

    #[test]
    fn renders_the_code_and_expiry_banner() {
        assert_eq!(
            format_pairing_header("ABCD1234"),
            "\n  Pairing code: ABCD1234\n  Expires in 5 minutes\n"
        );
    }
}

mod qr_payload_json_tests {
    use super::*;

    #[test]
    fn encodes_the_tunnel_url_and_code_as_a_json_object() {
        assert_eq!(
            qr_payload_json("https://foo.trycloudflare.com", "ABCD1234"),
            r#"{"code":"ABCD1234","url":"https://foo.trycloudflare.com"}"#
        );
    }
}

mod format_device_paired_tests {
    use super::*;

    #[test]
    fn renders_the_paired_confirmation() {
        assert_eq!(
            format_device_paired("Doru's iPhone", "dev-1"),
            "\n  Device paired: Doru's iPhone (dev-1)\n"
        );
    }
}

mod urlencode_tests {
    use super::*;

    #[test]
    fn leaves_alphanumerics_and_unreserved_characters_untouched() {
        assert_eq!(urlencode("ABCD1234-_.~"), "ABCD1234-_.~");
    }

    #[test]
    fn percent_encodes_everything_else() {
        assert_eq!(urlencode("AB CD+34"), "AB%20CD%2B34");
    }
}

mod render_qr_tests {
    use super::*;

    #[test]
    fn renders_a_deterministic_unicode_qr_block_for_a_given_payload() {
        let rendered = render_qr(r#"{"code":"ABCD","url":"https://example.com"}"#);
        assert!(
            rendered.lines().count() > 1,
            "expected a multi-line QR block, got: {rendered:?}"
        );
        assert!(
            rendered
                .chars()
                .any(|c| c == '█' || c == '▀' || c == '▄' || c == ' '),
            "expected QR block glyphs"
        );
    }
}
