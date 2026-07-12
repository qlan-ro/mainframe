//! Ported from `packages/types/src/tags.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TagColor {
    Blue,
    Red,
    Purple,
    Violet,
    Amber,
    Teal,
    Cyan,
    Green,
    Pink,
    Orange,
}

pub const TAG_PALETTE: [TagColor; 10] = [
    TagColor::Blue,
    TagColor::Red,
    TagColor::Purple,
    TagColor::Violet,
    TagColor::Amber,
    TagColor::Teal,
    TagColor::Cyan,
    TagColor::Green,
    TagColor::Pink,
    TagColor::Orange,
];

/// Used for synthetic chips in the filter bar — outside the user palette so it
/// signals "system" visually.
pub const SYNTHETIC_TAG_COLOR: &str = "gray";
pub const RESERVED_TAG_PREFIX: &str = "has-";

pub const SYNTHETIC_TAGS: [&str; 2] = ["has-pr", "has-worktree"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    pub color: TagColor,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_palette_is_non_empty() {
        assert!(!TAG_PALETTE.is_empty());
    }

    #[test]
    fn reserved_tag_prefix_is_has() {
        assert_eq!(RESERVED_TAG_PREFIX, "has-");
    }

    #[test]
    fn synthetic_tags_contains_has_pr_and_has_worktree_only() {
        let mut sorted = SYNTHETIC_TAGS;
        sorted.sort_unstable();
        assert_eq!(sorted, ["has-pr", "has-worktree"]);
    }

    #[test]
    fn tag_color_serializes_camelcase() {
        assert_eq!(serde_json::to_string(&TagColor::Blue).unwrap(), "\"blue\"");
    }

    #[test]
    fn tag_round_trips() {
        let json = r#"{"name":"backend","color":"teal","createdAt":"2026-07-08T00:00:00Z"}"#;
        let tag: Tag = serde_json::from_str(json).unwrap();
        assert_eq!(tag.color, TagColor::Teal);
        assert_eq!(serde_json::to_string(&tag).unwrap(), json);
    }
}

// PORT STATUS: packages/types/src/tags.ts (28 lines)
// confidence: high
// todos: 0
// notes: TagColor is a Rust enum (camelCase rename) + a const TAG_PALETTE array,
// mirroring the frozen TS const-array + literal-union pair. SyntheticTag /
// SyntheticTagColor literal-union aliases collapse into the SYNTHETIC_TAGS /
// SYNTHETIC_TAG_COLOR consts. `Object.isFrozen` has no Rust analogue (const arrays
// are immutable by construction), so that assertion is dropped.
