use super::*;

#[test]
fn block_scalar_description_becomes_first_sentence() {
    let raw = "---\nname: todo317-planner\ndescription: |\n  Use this agent to write a spec or an implementation plan from an approved brainstorm/design. Examples:\n\n  <example>\n  user: \"hi\"\n  assistant: \"yo\"\n  </example>\n---\n\n# todo317-planner\n\nBody.";
    let derived = derive_agent_description(raw);
    assert_eq!(
        derived.summary,
        "Use this agent to write a spec or an implementation plan from an approved brainstorm/design."
    );
    assert!(!derived.summary.contains("Examples:"));
    assert!(!derived.summary.contains("<example>"));
}

#[test]
fn example_markup_first_line_is_skipped() {
    let full = "<example>\nActual description sentence here.\n</example>";
    assert_eq!(summarize(full), "Actual description sentence here.");
}

#[test]
fn abbreviation_guard_keeps_sentence_intact() {
    assert_eq!(
        summarize("Runs e.g. codex or claude. Second sentence."),
        "Runs e.g. codex or claude."
    );
}

#[test]
fn no_frontmatter_uses_heading_heuristic() {
    let derived = derive_agent_description("# todo317-legacy\n\nBody text.");
    assert_eq!(derived.summary, "todo317-legacy");
    assert!(derived.full.is_none());
}

#[test]
fn empty_description_falls_back_to_body_heading() {
    let raw = "---\nname: x\ndescription:\n---\n\n# todo317-empty\n\nbody";
    let derived = derive_agent_description(raw);
    assert_eq!(derived.summary, "todo317-empty");
    assert_ne!(derived.summary, "---");
}

#[test]
fn no_sentence_terminator_keeps_whole_line() {
    assert_eq!(
        summarize("No terminator here just words"),
        "No terminator here just words"
    );
}

#[test]
fn long_single_sentence_is_capped() {
    let long = "a".repeat(400);
    let summary = summarize(&long);
    assert!(summary.chars().count() <= 201);
    assert!(summary.ends_with('…'));
}

#[test]
fn full_carries_complete_multi_paragraph_value() {
    let raw = "---\nname: x\ndescription: |\n  First line here. Examples:\n\n  <example>\n  content\n  </example>\n---\n\nBody";
    let derived = derive_agent_description(raw);
    let full = derived.full.expect("full description");
    assert!(full.contains("<example>"));
    assert!(full.contains("content"));
}
