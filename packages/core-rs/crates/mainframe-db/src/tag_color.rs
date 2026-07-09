//! Ported from `packages/core/src/lib/tag-color.ts`.
//!
//! Relocated into `mainframe-db` (its sole consumer, `tags.rs`) per PORTING.md
//! §2.15's explicit example ("`tag_color` only used by `mainframe-db`, the
//! trailer records the move"); it does NOT also land in `mainframe-services`.

use mainframe_types::tags::{TAG_PALETTE, TagColor};

/// Stable djb2 hash → palette index. Same name always maps to same color.
pub fn hash_tag_color(name: &str) -> TagColor {
    let mut h: i32 = 5381;
    // charCodeAt() iterates UTF-16 code units; encode_utf16() reproduces that
    // exactly. The `| 0` truncation in JS matches i32 wrapping arithmetic.
    for unit in name.encode_utf16() {
        h = h
            .wrapping_shl(5)
            .wrapping_add(h)
            .wrapping_add(i32::from(unit));
    }
    // Math.abs(i32::MIN) overflows i32; widen to i64 to match JS float abs.
    let idx = (i64::from(h).abs() % TAG_PALETTE.len() as i64) as usize;
    TAG_PALETTE[idx]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_a_palette_color() {
        let c = hash_tag_color("feature");
        assert!(TAG_PALETTE.contains(&c));
    }

    #[test]
    fn is_deterministic_for_the_same_name() {
        assert_eq!(hash_tag_color("bug"), hash_tag_color("bug"));
    }

    #[test]
    fn distributes_across_different_names() {
        // TagColor is not Hash; assert more than one distinct value directly.
        let colors: Vec<TagColor> = ["a", "b", "c", "d", "e", "f", "g", "h"]
            .iter()
            .map(|n| hash_tag_color(n))
            .collect();
        assert!(colors.iter().any(|c| *c != colors[0]));
    }
}

// PORT STATUS: src/lib/tag-color.ts (11 lines)
// confidence: high
// notes: RELOCATED from lib/ into mainframe-db per §2.15 (sole consumer is
// tags.rs; mainframe-services isn't available and would risk a cycle). djb2 hash
// uses i32 wrapping arithmetic to mirror JS `| 0`; encode_utf16() mirrors
// charCodeAt(); the index uses i64 abs to avoid i32::MIN overflow (JS Math.abs
// promotes to float). Tests ported from lib/__tests__/tag-color.test.ts.
// todos: 0
