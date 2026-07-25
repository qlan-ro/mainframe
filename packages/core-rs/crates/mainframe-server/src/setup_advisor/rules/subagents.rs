//! Subagent rules — `.claude/agents/<name>.md` scaffolds.
//!
//! Mappings come from the upstream `claude-code-setup` v1.0.0 bundle
//! (`references/subagents-reference.md`). No external provenance applies: each
//! `command` is a Markdown body authored here, and its frontmatter follows the
//! subagent file format at https://code.claude.com/docs/en/sub-agents.
//! Provenance: `docs/research/2026-07-25-todo-191-command-provenance.md`.

use mainframe_types::setup_advisor::{
    ProjectFingerprint, RecommendationCategory, RecommendationProvenance,
};

use super::{has, large_project_evidence};
use crate::setup_advisor::rule::Rule;

/// Dependencies whose presence means the project handles money or identity.
const SENSITIVE_APIS: &[&str] = &["stripe", "next-auth", "clerk", "auth0", "passport"];

const FRONTEND_FRAMEWORKS: &[&str] = &["react", "nextjs", "vue", "angular", "svelte"];

const BACKEND_FRAMEWORKS: &[&str] = &["express", "fastapi", "django"];

/// The first of `candidates` present in `values`, so the evidence names the
/// dependency that actually fired rather than the whole list.
fn first_of(values: &[String], candidates: &[&'static str]) -> Option<&'static str> {
    candidates
        .iter()
        .copied()
        .find(|candidate| has(values, candidate))
}

fn dependency_evidence(values: &[String], candidates: &[&'static str]) -> Option<String> {
    first_of(values, candidates).map(|label| format!("{label} in the project dependencies"))
}

/// Fires only on a real gap: code in a known language, no test framework, and
/// no `tests/` directory to hold one.
fn missing_tests(fp: &ProjectFingerprint) -> Option<String> {
    if !fp.testing.is_empty() || has(&fp.dirs, "tests") {
        return None;
    }
    let language = fp.languages.first()?;
    Some(format!("{language} sources and no test framework"))
}

/// An `api/` directory and a backend framework are the same fact to the reader:
/// this project serves an interface someone else calls.
fn api_surface(fp: &ProjectFingerprint) -> Option<String> {
    if has(&fp.dirs, "api") {
        return Some("an api/ directory at the repo root".to_string());
    }
    dependency_evidence(&fp.frameworks, BACKEND_FRAMEWORKS)
}

pub static RULES: &[Rule] = &[
    // Body authored here; frontmatter per code.claude.com/docs/en/sub-agents.
    Rule {
        id: "subagents-security-reviewer",
        category: RecommendationCategory::Subagents,
        title: "security-reviewer",
        why: "The payment and auth paths get a security pass before they reach your PR.",
        command: r#"---
name: security-reviewer
description: Reviews auth, payment, and secret-handling changes. Use before merging anything that touches those paths.
tools: Read, Grep, Glob
model: inherit
---

You review this project's authentication, payment, and secret-handling code.

For each change, trace where untrusted input enters, confirm secrets are read
from the environment rather than source, and check that authorization is
enforced on the server. Report findings by severity with file and line. Report
only — do not edit.
"#,
        target_path: Some(".claude/agents/security-reviewer.md"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 10,
        evidence: |fp| dependency_evidence(&fp.external_apis, SENSITIVE_APIS),
    },
    // Body authored here; frontmatter per code.claude.com/docs/en/sub-agents.
    Rule {
        id: "subagents-test-writer",
        category: RecommendationCategory::Subagents,
        title: "test-writer",
        why: "Nothing tests this project yet — an agent writes the first suite instead of you.",
        command: r#"---
name: test-writer
description: Writes tests for existing code. Use when a module has no coverage or a bug needs a regression test.
tools: Read, Grep, Glob, Edit, Write, Bash
model: inherit
---

You write tests for this project.

Assert concrete expected values; never recompute the result with the same logic
the implementation uses. Cover the failure paths and boundaries, not just the
happy path. Run the suite you wrote and report its output before claiming it
passes.
"#,
        target_path: Some(".claude/agents/test-writer.md"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 20,
        evidence: missing_tests,
    },
    // Body authored here; frontmatter per code.claude.com/docs/en/sub-agents.
    Rule {
        id: "subagents-code-reviewer",
        category: RecommendationCategory::Subagents,
        title: "code-reviewer",
        why: "A dedicated reviewer reads Claude's diffs first, on a codebase too big to eyeball.",
        command: r#"---
name: code-reviewer
description: Reviews a diff for correctness, security, and maintainability. Use after a change is complete.
tools: Read, Grep, Glob, Bash
model: inherit
---

You review changes to this codebase.

Read the diff and the code around it before judging. Lead with correctness bugs,
then security, then maintainability; state the file, the line, and what breaks.
Say when a change is fine. Report only — do not edit.
"#,
        target_path: Some(".claude/agents/code-reviewer.md"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 30,
        evidence: large_project_evidence,
    },
    // Body authored here; frontmatter per code.claude.com/docs/en/sub-agents.
    Rule {
        id: "subagents-performance-analyzer",
        category: RecommendationCategory::Subagents,
        title: "performance-analyzer",
        why: "Slow queries get caught by an agent that reads your schema, not by production.",
        command: r#"---
name: performance-analyzer
description: Finds slow queries, N+1 access patterns, and missing indexes. Use when a data path feels slow.
tools: Read, Grep, Glob, Bash
model: inherit
---

You analyze this project's data access for performance problems.

Start from the schema and the queries that touch it. Look for N+1 loops, missing
indexes on filtered columns, and unbounded result sets. Quantify the cost before
proposing a change, and propose the smallest one that fixes it.
"#,
        target_path: Some(".claude/agents/performance-analyzer.md"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 40,
        evidence: |fp| {
            fp.databases
                .first()
                .map(|db| format!("{db} in the project dependencies"))
        },
    },
    // Body authored here; frontmatter per code.claude.com/docs/en/sub-agents.
    Rule {
        id: "subagents-api-documenter",
        category: RecommendationCategory::Subagents,
        title: "api-documenter",
        why: "Your endpoints get documented as they change, instead of drifting from the code.",
        command: r#"---
name: api-documenter
description: Documents HTTP endpoints from their handlers. Use after adding or changing a route.
tools: Read, Grep, Glob, Edit, Write
model: inherit
---

You document this project's HTTP surface.

Read the handler and its validation before writing a line. Record the method,
path, request and response shapes, status codes, and auth requirement. Describe
what the endpoint does, never what it should do.
"#,
        target_path: Some(".claude/agents/api-documenter.md"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 50,
        evidence: api_surface,
    },
    // Body authored here; frontmatter per code.claude.com/docs/en/sub-agents.
    Rule {
        id: "subagents-ui-reviewer",
        category: RecommendationCategory::Subagents,
        title: "ui-reviewer",
        why: "Components get an accessibility and interaction-state pass before they ship.",
        command: r#"---
name: ui-reviewer
description: Reviews components for accessibility, responsive behavior, and state coverage. Use after building UI.
tools: Read, Grep, Glob
model: inherit
---

You review this project's user interface code.

Check keyboard reachability, focus order, labels, and contrast. Confirm every
interactive element has loading, empty, error, and disabled states. Name the
component and the state that is missing. Report only — do not edit.
"#,
        target_path: Some(".claude/agents/ui-reviewer.md"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 60,
        evidence: |fp| dependency_evidence(&fp.frameworks, FRONTEND_FRAMEWORKS),
    },
];
