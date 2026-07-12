//! Ported from `packages/core/src/plugins/builtin/claude/frontmatter.ts`.
//!
//! Minimal SKILL.md / command YAML-frontmatter reader/writer. Not a full YAML
//! parser: it only splits `key: value` lines between the first two `---`
//! fences, exactly like the TS source.

use std::collections::HashMap;

/// Parsed frontmatter: a flat `key: value` attribute map plus the body below the
/// closing fence. `attributes` mirrors the TS `Record<string, string>`.
pub struct Frontmatter {
    pub attributes: HashMap<String, String>,
    pub body: String,
}

pub fn parse_frontmatter(content: &str) -> Frontmatter {
    let mut attributes: HashMap<String, String> = HashMap::new();

    if !content.starts_with("---") {
        return Frontmatter {
            attributes,
            body: content.to_string(),
        };
    }

    // `content.indexOf('---', 3)` — search for the closing fence after the open.
    let end_index = match content[3..].find("---") {
        Some(i) => i + 3,
        None => {
            return Frontmatter {
                attributes,
                body: content.to_string(),
            };
        }
    };

    let frontmatter_block = content[3..end_index].trim();
    let body = content[end_index + 3..].trim().to_string();

    for line in frontmatter_block.split('\n') {
        let colon_index = match line.find(':') {
            Some(i) => i,
            None => continue,
        };
        let key = line[..colon_index].trim();
        let value = line[colon_index + 1..].trim();
        if !key.is_empty() {
            attributes.insert(key.to_string(), value.to_string());
        }
    }

    Frontmatter { attributes, body }
}

/// Serialize ordered `key: value` attributes with the body below the fence.
///
/// The TS signature is `buildFrontmatter(attrs: Record<string, string>, body)`
/// and iterates `Object.entries(attrs)` in insertion order. A Rust `HashMap`
/// has no insertion order, so the port takes an ordered slice; the sole caller
/// (`createSkill`) passes `[("name", …), ("description", …)]`.
pub fn build_frontmatter(attrs: &[(&str, &str)], body: &str) -> String {
    let lines: Vec<String> = attrs.iter().map(|(k, v)| format!("{k}: {v}")).collect();
    format!("---\n{}\n---\n\n{}", lines.join("\n"), body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_key_value_attributes_and_body() {
        let content = "---\nname: PDF\ndescription: Work with PDFs\n---\n\n# Body here";
        let fm = parse_frontmatter(content);
        assert_eq!(fm.attributes.get("name").map(String::as_str), Some("PDF"));
        assert_eq!(
            fm.attributes.get("description").map(String::as_str),
            Some("Work with PDFs")
        );
        assert_eq!(fm.body, "# Body here");
    }

    #[test]
    fn no_fence_returns_content_as_body() {
        let fm = parse_frontmatter("plain markdown");
        assert!(fm.attributes.is_empty());
        assert_eq!(fm.body, "plain markdown");
    }

    #[test]
    fn missing_closing_fence_returns_content_as_body() {
        let fm = parse_frontmatter("---\nname: X\nno closing fence");
        assert!(fm.attributes.is_empty());
        assert_eq!(fm.body, "---\nname: X\nno closing fence");
    }

    #[test]
    fn skips_lines_without_a_colon() {
        let fm = parse_frontmatter("---\nname: X\nnovalue\n---\nbody");
        assert_eq!(fm.attributes.len(), 1);
        assert_eq!(fm.attributes.get("name").map(String::as_str), Some("X"));
    }

    #[test]
    fn build_round_trips_ordered_keys() {
        let out = build_frontmatter(&[("name", "PDF"), ("description", "d")], "# Body");
        assert_eq!(out, "---\nname: PDF\ndescription: d\n---\n\n# Body");
    }
}

// PORT STATUS: src/plugins/builtin/claude/frontmatter.ts (30 lines)
// confidence: high
// todos: 0
// notes: parseFrontmatter returns a Frontmatter struct (attributes map + body).
// buildFrontmatter takes an ordered &[(&str,&str)] instead of a Record so the
// emitted key order (name, description) matches the TS Object.entries order —
// HashMap has no insertion order. Sole caller is skills::create_skill.
