//! Ported from `packages/core/src/plugins/builtin/claude/frontmatter.ts`, then
//! rebuilt for todo #317 into a single-pass, line-anchored reader.
//!
//! Minimal SKILL.md / command YAML-frontmatter reader/writer. Not a full YAML
//! parser. Supported: inline `key: value` scalars split at the first colon;
//! `|`/`>` block scalars with `-`/`+` chomping (clip, YAML's unmarked
//! default, is treated as strip — see `block_scalar`'s module doc); CRLF line
//! endings. Not supported: explicit indentation indicators (`|2`), quoting,
//! nested maps, and lists — none of these appear in agent or skill files
//! (todo #317 Decision D8). The closing fence is a line that is exactly
//! `---`, so a `---` inside the body or an indented block-scalar line never
//! truncates the frontmatter early.

use std::collections::HashMap;

mod block_scalar;

/// Parsed frontmatter: a flat `key: value` attribute map plus the body below the
/// closing fence. `attributes` mirrors the TS `Record<string, string>`.
pub struct Frontmatter {
    pub attributes: HashMap<String, String>,
    pub body: String,
}

pub fn parse_frontmatter(content: &str) -> Frontmatter {
    let lines: Vec<&str> = content
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();

    let unfenced = || Frontmatter {
        attributes: HashMap::new(),
        body: content.to_string(),
    };

    if lines.first() != Some(&"---") {
        return unfenced();
    }
    let Some(fence_end) = lines
        .iter()
        .skip(1)
        .position(|line| *line == "---")
        .map(|i| i + 1)
    else {
        return unfenced();
    };

    let mut attributes = HashMap::new();
    let mut i = 1;
    while i < fence_end {
        i = parse_attribute_line(&lines, i, &mut attributes);
    }

    let body = lines[fence_end + 1..].join("\n").trim().to_string();
    Frontmatter { attributes, body }
}

/// Parses the attribute at `lines[i]` — an inline scalar or a block-scalar
/// header — and returns the index of the next unconsumed line.
fn parse_attribute_line(
    lines: &[&str],
    i: usize,
    attributes: &mut HashMap<String, String>,
) -> usize {
    let Some(colon_index) = lines[i].find(':') else {
        return i + 1;
    };
    let key = lines[i][..colon_index].trim();
    let value = lines[i][colon_index + 1..].trim();
    if key.is_empty() {
        return i + 1;
    }

    if let Some(header) = block_scalar::parse_header(value) {
        let (block_value, next) = block_scalar::read_block(lines, i + 1, &header);
        attributes.insert(key.to_string(), block_value);
        return next;
    }

    attributes.insert(key.to_string(), value.to_string());
    i + 1
}

/// Serialize ordered `key: value` attributes with the body below the fence.
///
/// The TS signature is `buildFrontmatter(attrs: Record<string, string>, body)`
/// and iterates `Object.entries(attrs)` in insertion order. A Rust `HashMap`
/// has no insertion order, so the port takes an ordered slice; the sole caller
/// (`createSkill`) passes `[("name", …), ("description", …)]`.
pub fn build_frontmatter(attrs: &[(&str, &str)], body: &str) -> String {
    let lines: Vec<String> = attrs
        .iter()
        .map(|(k, v)| build_attribute_line(k, v))
        .collect();
    format!("---\n{}\n---\n\n{}", lines.join("\n"), body)
}

/// A single-line value is emitted inline; a colon inside it needs no quoting
/// because the reader splits at the first colon only. A multi-line value is
/// emitted as a `|-`/`|+` literal block scalar (`-` when it has no trailing
/// newline, `+` when it does) so `parse_frontmatter` reads it back unchanged.
fn build_attribute_line(key: &str, value: &str) -> String {
    if !value.contains('\n') {
        return format!("{key}: {value}");
    }

    let header = if value.ends_with('\n') { "|+" } else { "|-" };
    let mut line = format!("{key}: {header}");
    for content_line in value.split('\n') {
        line.push_str("\n  ");
        line.push_str(content_line);
    }
    line
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
