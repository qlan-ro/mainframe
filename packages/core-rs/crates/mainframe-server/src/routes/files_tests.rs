use super::*;

#[test]
fn base64_matches_node_buffer() {
    assert_eq!(mainframe_types::base64_data::encode(b""), "");
    assert_eq!(mainframe_types::base64_data::encode(b"f"), "Zg==");
    assert_eq!(mainframe_types::base64_data::encode(b"fo"), "Zm8=");
    assert_eq!(mainframe_types::base64_data::encode(b"foo"), "Zm9v");
    assert_eq!(
        mainframe_types::base64_data::encode(b"hello world\n"),
        "aGVsbG8gd29ybGQK"
    );
}

#[test]
fn fuzzy_match_is_subsequence() {
    assert!(fuzzy_match("hlo", "hello"));
    assert!(!fuzzy_match("xyz", "hello"));
    assert!(fuzzy_match("abc", "aXbXc"));
}

#[test]
fn parse_limit_clamps_and_defaults() {
    assert_eq!(parse_limit(None, 50, 200), 50);
    assert_eq!(parse_limit(Some("30"), 50, 200), 30);
    assert_eq!(parse_limit(Some("0"), 50, 200), 50);
    assert_eq!(parse_limit(Some("9999"), 50, 200), 200);
    assert_eq!(parse_limit(Some("junk"), 50, 200), 50);
}

#[test]
fn blocklist_rejects_sensitive_paths() {
    assert!(is_blocked_external("/etc/shadow"));
    assert!(is_blocked_external("/etc/sudoers/extra"));
    assert!(is_blocked_external("/home/u/.ssh/id_rsa"));
    assert!(is_blocked_external("/home/u/.aws/credentials"));
    assert!(is_blocked_external("/home/u/.netrc"));
    assert!(is_blocked_external("/home/u/.gnupg/secring.gpg"));
    assert!(!is_blocked_external("/home/u/.aws/config"));
    assert!(!is_blocked_external("/home/u/project/file.txt"));
}
