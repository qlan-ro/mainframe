//! Tag name validation for `tags.rs`.

use mainframe_types::tags::RESERVED_TAG_PREFIX;

use crate::DbError;

const MIN_LEN: usize = 2;
const MAX_LEN: usize = 24;

fn is_valid_pattern(s: &str) -> bool {
    // /^[a-z0-9-]+$/ — non-empty run of lowercase ascii, digits, or hyphen.
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// The normalized (trimmed, lowercased) name, or `DbError::Invalid` with the
/// message the tags API returns.
pub(crate) fn validate_tag_name(input: &str) -> Result<String, DbError> {
    let normalized = normalize_tag_name(input);
    let length = normalized.chars().count();
    let error = if length < MIN_LEN {
        format!("Tag name too short (min {MIN_LEN} chars).")
    } else if length > MAX_LEN {
        format!("Tag name too long (max {MAX_LEN} chars).")
    } else if normalized.starts_with(RESERVED_TAG_PREFIX) {
        format!("Names starting with \"{RESERVED_TAG_PREFIX}\" are reserved.")
    } else if !is_valid_pattern(&normalized) {
        "Tag name must use lowercase letters, numbers, or hyphens only.".to_string()
    } else {
        return Ok(normalized);
    };
    Err(DbError::Invalid(error))
}

pub(crate) fn normalize_tag_name(input: &str) -> String {
    input.trim().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_names() {
        for (input, expected) in [
            ("feature", "feature"),
            ("  Feature  ", "feature"),
            ("ui-bug", "ui-bug"),
            ("perf-2", "perf-2"),
        ] {
            assert_eq!(validate_tag_name(input).unwrap(), expected);
        }
    }

    #[test]
    fn rejects_invalid_names() {
        for input in [
            "",
            "a",
            &"a".repeat(25),
            "has-pr",
            "has-anything",
            "feature!",
            "white space",
        ] {
            assert!(matches!(validate_tag_name(input), Err(DbError::Invalid(_))));
        }
    }
}
