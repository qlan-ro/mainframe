//! Ported from `packages/core/src/lib/validate-tag-name.ts`.
//!
//! Relocated into `mainframe-db` (its sole consumer, `tags.rs`) per PORTING.md
//! §2.15, alongside `tag_color`.

use mainframe_types::tags::RESERVED_TAG_PREFIX;

const MIN_LEN: usize = 2;
const MAX_LEN: usize = 24;

/// Discriminated result mirroring the TS `ValidateResult` union
/// (`{ ok: true, normalized } | { ok: false, error }`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidateResult {
    Ok { normalized: String },
    Err { error: String },
}

fn is_valid_pattern(s: &str) -> bool {
    // /^[a-z0-9-]+$/ — non-empty run of lowercase ascii, digits, or hyphen.
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub fn validate_tag_name(input: &str) -> ValidateResult {
    let normalized = input.trim().to_lowercase();
    if normalized.chars().count() < MIN_LEN {
        return ValidateResult::Err {
            error: "Tag name too short (min 2 chars).".to_string(),
        };
    }
    if normalized.chars().count() > MAX_LEN {
        return ValidateResult::Err {
            error: "Tag name too long (max 24 chars).".to_string(),
        };
    }
    if normalized.starts_with(RESERVED_TAG_PREFIX) {
        return ValidateResult::Err {
            error: format!("Names starting with \"{RESERVED_TAG_PREFIX}\" are reserved."),
        };
    }
    if !is_valid_pattern(&normalized) {
        return ValidateResult::Err {
            error: "Tag name must use lowercase letters, numbers, or hyphens only.".to_string(),
        };
    }
    ValidateResult::Ok { normalized }
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
            assert_eq!(
                validate_tag_name(input),
                ValidateResult::Ok {
                    normalized: expected.to_string()
                }
            );
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
            assert!(matches!(
                validate_tag_name(input),
                ValidateResult::Err { .. }
            ));
        }
    }
}

// PORT STATUS: src/lib/validate-tag-name.ts (21 lines)
// confidence: high
// notes: RELOCATED from lib/ into mainframe-db per §2.15 (sole consumer is
// tags.rs). ValidateResult is a Rust enum mirroring the TS discriminated union;
// error strings are byte-identical (asserted by tags.rs regex tests). Length
// checks use char counts (JS `.length` is UTF-16 units, but tag input is ASCII).
// Tests ported from lib/__tests__/validate-tag-name.test.ts.
// todos: 0
