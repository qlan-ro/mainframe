//! RED-phase tests for todo #317 — `parse_frontmatter` cannot read the YAML
//! block scalars (`description: |` / `>`) real agent and skill files use, and
//! finds the closing fence by substring search rather than by line. See
//! `docs/plans/2026-08-09-todo-317-agent-description-frontmatter-plan.md`
//! Task 1.
//!
//! Cases 1-5 and 10-11 fail against today's parser; the rest are green
//! regression guards that must stay green once the parser is rebuilt.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_adapter_claude::frontmatter::{build_frontmatter, parse_frontmatter};

#[test]
fn literal_block_scalar_keeps_newlines() {
    let content = "---\nname: X\ndescription: |\n  first line\n  second line\n---\n\nbody";
    let fm = parse_frontmatter(content);
    assert_eq!(fm.attributes.get("name").map(String::as_str), Some("X"));
    assert_eq!(
        fm.attributes.get("description").map(String::as_str),
        Some("first line\nsecond line")
    );
}

#[test]
fn folded_block_scalar_joins_lines() {
    let content = "---\ndescription: >\n  first line\n  second line\n\n  third line\n---\n\nbody";
    let fm = parse_frontmatter(content);
    assert_eq!(
        fm.attributes.get("description").map(String::as_str),
        Some("first line second line\nthird line")
    );
}

#[test]
fn chomping_indicators() {
    let strip = "---\ndescription: |-\n  line one\n  line two\n\n---\n\nbody";
    let clip = "---\ndescription: |\n  line one\n  line two\n\n---\n\nbody";
    let keep = "---\ndescription: |+\n  line one\n  line two\n\n---\n\nbody";

    assert_eq!(
        parse_frontmatter(strip)
            .attributes
            .get("description")
            .map(String::as_str),
        Some("line one\nline two")
    );
    assert_eq!(
        parse_frontmatter(clip)
            .attributes
            .get("description")
            .map(String::as_str),
        Some("line one\nline two")
    );
    assert_eq!(
        parse_frontmatter(keep)
            .attributes
            .get("description")
            .map(String::as_str),
        Some("line one\nline two\n")
    );
}

#[test]
fn block_scalar_swallows_colons() {
    let content = "---\nname: X\ndescription: |\n  <example>\n  user: \"hi\"\n  assistant: \"yo\"\n  </example>\n---\n\nbody";
    let fm = parse_frontmatter(content);
    assert_eq!(fm.attributes.len(), 2);
    assert!(fm.attributes.contains_key("name"));
    assert!(fm.attributes.contains_key("description"));
    assert!(!fm.attributes.contains_key("user"));
    assert!(!fm.attributes.contains_key("assistant"));
}

#[test]
fn indented_triple_dash_does_not_end_frontmatter() {
    let content =
        "---\nname: X\ndescription: |\n  intro\n  ---\n  more\ntools: Read, Grep\n---\n\nbody";
    let fm = parse_frontmatter(content);
    assert_eq!(
        fm.attributes.get("tools").map(String::as_str),
        Some("Read, Grep")
    );
    assert_eq!(
        fm.attributes.get("description").map(String::as_str),
        Some("intro\n---\nmore")
    );
}

#[test]
fn body_triple_dash_is_not_the_closing_fence() {
    let content = "---\nname: X\n---\n\nintro\n\n---\n\nmore";
    let fm = parse_frontmatter(content);
    assert_eq!(fm.attributes.get("name").map(String::as_str), Some("X"));
    assert!(fm.body.starts_with("intro"), "body was: {:?}", fm.body);
    assert!(fm.body.contains("---"), "body was: {:?}", fm.body);
}

#[test]
fn unfenced_leading_dashes_are_not_frontmatter() {
    let content = "----- banner\n\nbody";
    let fm = parse_frontmatter(content);
    assert!(fm.attributes.is_empty());
    assert_eq!(fm.body, content);
}

#[test]
fn crlf_frontmatter_parses() {
    let lf = "---\nname: PDF\ndescription: Work with PDFs\n---\n\n# Body here";
    let crlf = lf.replace('\n', "\r\n");
    let fm = parse_frontmatter(&crlf);
    assert_eq!(fm.attributes.get("name").map(String::as_str), Some("PDF"));
    assert_eq!(
        fm.attributes.get("description").map(String::as_str),
        Some("Work with PDFs")
    );
    assert_eq!(fm.body, "# Body here");
}

#[test]
fn inline_scalar_unchanged() {
    let a = parse_frontmatter("---\nname: PDF\ndescription: Work with PDFs\n---\n\nbody");
    assert_eq!(a.attributes.get("name").map(String::as_str), Some("PDF"));
    assert_eq!(
        a.attributes.get("description").map(String::as_str),
        Some("Work with PDFs")
    );

    let b = parse_frontmatter("---\ndescription: Handles a: b\n---\n\nbody");
    assert_eq!(
        b.attributes.get("description").map(String::as_str),
        Some("Handles a: b")
    );
}

#[test]
fn build_round_trips_multiline_value() {
    let out = build_frontmatter(
        &[
            ("name", "x"),
            ("description", "line one\nline two: with colon"),
        ],
        "# Body",
    );
    let fm = parse_frontmatter(&out);
    assert_eq!(
        fm.attributes.get("description").map(String::as_str),
        Some("line one\nline two: with colon")
    );
    assert_eq!(fm.body, "# Body");
}

#[test]
fn build_round_trips_trailing_newline_value() {
    let out = build_frontmatter(
        &[("name", "x"), ("description", "trailing content\n")],
        "# Body",
    );
    let fm = parse_frontmatter(&out);
    assert_eq!(
        fm.attributes.get("description").map(String::as_str),
        Some("trailing content\n")
    );
}

#[test]
fn build_round_trips_inline_colon_value() {
    let out = build_frontmatter(&[("name", "x"), ("description", "Handles a: b")], "# Body");
    let fm = parse_frontmatter(&out);
    assert_eq!(
        fm.attributes.get("description").map(String::as_str),
        Some("Handles a: b")
    );
}
