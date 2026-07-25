//! Hooks rules — `.claude/settings.json` snippets.
//!
//! Mappings come from the upstream `claude-code-setup` v1.0.0 bundle
//! (`references/hooks-patterns.md`), which carries the detection rationale but
//! no usable snippets. Every `command` below is therefore authored here against
//! the Claude Code hooks documentation — https://code.claude.com/docs/en/hooks —
//! the source for the event names, the `settings.json` shape, and which events
//! accept a matcher. Provenance:
//! `docs/research/2026-07-25-todo-191-command-provenance.md`.

use mainframe_types::setup_advisor::{
    ProjectFingerprint, RecommendationCategory, RecommendationProvenance,
};

use super::has;
use crate::setup_advisor::rule::Rule;

/// Names the linter that actually fired — the rule accepts either.
fn linter(fp: &ProjectFingerprint) -> Option<String> {
    if has(&fp.tooling, "eslint") {
        return Some("an ESLint config at the repo root".to_string());
    }
    has(&fp.tooling, "ruff").then(|| "a ruff.toml at the repo root".to_string())
}

/// Distinguishes the two protected families, so the card never claims secrets
/// on a project that only has a lockfile.
fn protected_files(fp: &ProjectFingerprint) -> Option<String> {
    match (fp.has_env_files, fp.has_lock_files) {
        (true, true) => Some(".env files and lockfiles at the repo root".to_string()),
        (true, false) => Some(".env files at the repo root".to_string()),
        (false, true) => Some("lockfiles at the repo root".to_string()),
        (false, false) => None,
    }
}

pub static RULES: &[Rule] = &[
    // Docs: PreToolUse runs before the tool and exit code 2 blocks the call.
    Rule {
        id: "hooks-block-edits",
        category: RecommendationCategory::Hooks,
        title: "Block edits to secrets and lockfiles",
        why: "Claude cannot rewrite your .env or lockfiles, however sure it is that it should.",
        command: r#"{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "file=$(jq -r '.tool_input.file_path'); case \"$file\" in *.env|*.env.*|*.lock|*-lock.json|*-lock.yaml|*.lockb|*/go.sum) echo \"Blocked: $file is protected.\" >&2; exit 2;; esac"
          }
        ]
      }
    ]
  }
}"#,
        target_path: Some(".claude/settings.json"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 10,
        evidence: protected_files,
    },
    // Docs: PostToolUse with an `Edit|Write` matcher is the documented shape.
    Rule {
        id: "hooks-format-on-edit",
        category: RecommendationCategory::Hooks,
        title: "Format on edit",
        why: "Prettier runs on every file Claude touches, so formatting never lands in your diff.",
        command: r#"{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "file=$(jq -r '.tool_input.file_path'); if [ -n \"$file\" ]; then npx prettier --write \"$file\"; fi"
          }
        ]
      }
    ]
  }
}"#,
        target_path: Some(".claude/settings.json"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 20,
        evidence: |fp| {
            has(&fp.tooling, "prettier").then(|| "a Prettier config at the repo root".to_string())
        },
    },
    // Docs: same PostToolUse shape; the extension switch keeps one constant
    // command honest for a repo that has both linters.
    Rule {
        id: "hooks-lint-on-edit",
        category: RecommendationCategory::Hooks,
        title: "Lint on edit",
        why: "Lint errors surface the moment Claude writes a file, not on your next CI run.",
        command: r#"{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "file=$(jq -r '.tool_input.file_path'); case \"$file\" in *.py) ruff check --fix \"$file\";; *.ts|*.tsx|*.js|*.jsx) npx eslint --fix \"$file\";; esac"
          }
        ]
      }
    ]
  }
}"#,
        target_path: Some(".claude/settings.json"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 30,
        evidence: linter,
    },
    // Docs: PostToolUse again; tsc is project-wide, so it takes no file argument.
    Rule {
        id: "hooks-typecheck-on-edit",
        category: RecommendationCategory::Hooks,
        title: "Typecheck on edit",
        why: "Type errors surface while Claude is still in the file, not after the build.",
        command: r#"{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsc --noEmit -p tsconfig.json"
          }
        ]
      }
    ]
  }
}"#,
        target_path: Some(".claude/settings.json"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 40,
        evidence: |fp| {
            has(&fp.tooling, "tsconfig").then(|| "a tsconfig.json at the repo root".to_string())
        },
    },
    // Docs: PostToolUse again; a `tests/` directory says nothing about the
    // runner, so the snippet dispatches on the edited file's extension.
    Rule {
        id: "hooks-run-related-tests",
        category: RecommendationCategory::Hooks,
        title: "Run related tests",
        why: "The tests covering a file run as soon as Claude edits it.",
        command: r#"{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "file=$(jq -r '.tool_input.file_path'); case \"$file\" in *.py) python -m pytest -q;; *.ts|*.tsx|*.js|*.jsx) npx vitest related --run \"$file\";; esac"
          }
        ]
      }
    ]
  }
}"#,
        target_path: Some(".claude/settings.json"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 50,
        evidence: |fp| {
            has(&fp.dirs, "tests").then(|| "a tests/ directory at the repo root".to_string())
        },
    },
];
