/// Identifier segments accepted by daemon routes and attachment storage.
pub fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::is_safe_identifier;

    #[test]
    fn accepts_only_nonempty_ascii_identifier_segments() {
        assert!(is_safe_identifier("Ab9_-"));
        for invalid in ["", "a/b", "a b", "é", "a.b"] {
            assert!(!is_safe_identifier(invalid), "{invalid}");
        }
    }
}
