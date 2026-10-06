//! The daemon's identifier convention (`^[a-zA-Z0-9_-]+$`), shared by every
//! route that takes an id in a body. Hand-rolled so routes stay regex-free.

pub(crate) fn is_identifier(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_identifier_charset_only() {
        assert!(is_identifier("abc_DEF-123"));
        assert!(!is_identifier(""));
        assert!(!is_identifier("a b"));
        assert!(!is_identifier("a/b"));
        assert!(!is_identifier("é"));
    }
}
