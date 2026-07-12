//! Contract §5 — the authoritative action id → named outputs table, plus the
//! friendly output labels used in error messages. Frozen; the Phase-6 action
//! manifests must match it.

use super::scope::TokenType;

const ACTION_OUTPUTS: &[(&str, &[(&str, TokenType)])] = &[
    (
        "run_command",
        &[("output", TokenType::Text), ("exitCode", TokenType::Number)],
    ),
    ("files.append", &[]),
    ("files.write", &[]),
    ("files.read", &[("content", TokenType::Text)]),
    (
        "http.request",
        &[("status", TokenType::Number), ("body", TokenType::Text)],
    ),
    (
        "github.create_pr",
        &[("prUrl", TokenType::Text), ("prNumber", TokenType::Number)],
    ),
    ("github.list_prs", &[("prs", TokenType::List)]),
    ("notion.add_row", &[("pageUrl", TokenType::Text)]),
    (
        "ado.create_item",
        &[("workItemId", TokenType::Number), ("url", TokenType::Text)],
    ),
];

const MCP_OUTPUTS: &[(&str, TokenType)] = &[("result", TokenType::Text)];

/// Named outputs for an action id; unknown ids produce nothing (the ref
/// checker then reports their tokens as unavailable).
pub(crate) fn action_outputs(action_id: &str) -> &'static [(&'static str, TokenType)] {
    if action_id.starts_with("mcp:") {
        return MCP_OUTPUTS;
    }
    ACTION_OUTPUTS
        .iter()
        .find(|(id, _)| *id == action_id)
        .map(|(_, outputs)| *outputs)
        .unwrap_or(&[])
}

/// camelCase output name → friendly label for error messages (Node's
/// OUTPUT_LABELS).
pub(crate) fn output_label(name: &str) -> String {
    match name {
        "output" => "Output".to_string(),
        "exitCode" => "Exit code".to_string(),
        "content" => "File text".to_string(),
        "status" => "Status".to_string(),
        "body" => "Response".to_string(),
        "prUrl" => "PR URL".to_string(),
        "prNumber" => "PR number".to_string(),
        "prs" => "Open PRs".to_string(),
        "pageUrl" => "Page URL".to_string(),
        "workItemId" => "Work item ID".to_string(),
        "url" => "URL".to_string(),
        "result" => "Result".to_string(),
        other => capitalize(other),
    }
}

pub(crate) fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.3), not a TS port
// confidence: high
// todos: 0
// notes: table is contract §5 verbatim; `run_command` outputAs:"lines" still
//        catalogs `output` as text (Node catalog parity).
