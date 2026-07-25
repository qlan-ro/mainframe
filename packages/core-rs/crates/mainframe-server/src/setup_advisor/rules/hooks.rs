//! Hooks rules — `.claude/settings.json` snippets.
//!
//! Mappings come from the upstream `claude-code-setup` v1.0.0 bundle
//! (`references/hooks-patterns.md`), which carries the detection rationale but
//! no usable snippets. Every `command` below is therefore authored here against
//! the Claude Code hooks documentation — https://code.claude.com/docs/en/hooks —
//! the source for the event names, the `settings.json` shape, and which events
//! accept a matcher. Provenance:
//! `docs/research/2026-07-25-todo-191-command-provenance.md`.
//!
//! Two constraints shape every snippet below. Exit code 2 is the blocking
//! channel — PreToolUse 2 refuses the call, PostToolUse 2 hands stderr back as an
//! error — so a PostToolUse snippet may only reach it deliberately, never by
//! letting a tool fail on a file it was never meant to read. And hooks run
//! without a TTY, so `npx` is always pinned to `--no-install`: the bare form
//! prompts to install a missing package, gets no answer, and fails.

use mainframe_types::setup_advisor::{
    ProjectFingerprint, RecommendationCategory, RecommendationProvenance,
};

use super::families::{ESLINT_CONFIG, PRETTIER_CONFIG, RUFF_CONFIG, TSCONFIG};
use crate::setup_advisor::detections::Field;
use crate::setup_advisor::rule::{Evidence, Rule};

/// Names the linter that actually fired — the rule accepts either.
const LINTER: Evidence = Evidence::Either(&[ESLINT_CONFIG, RUFF_CONFIG]);

/// Names the runner the snippet can actually drive. A `tests/` directory says
/// nothing about what runs the files in it, and the snippet dispatches to these
/// two alone.
const RELATED_TEST_RUNNER: Evidence = Evidence::Either(&[
    Evidence::Detected(
        Field::Testing,
        "vitest",
        "vitest in package.json dependencies",
    ),
    Evidence::Detected(
        Field::Testing,
        "pytest",
        "pytest in the project's dependencies",
    ),
]);

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
        why: "Claude's Edit and Write stop at your .env and lockfiles, however sure it is that they should not.",
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
        evidence: Evidence::Custom(protected_files),
    },
    // Docs: PostToolUse with an `Edit|Write` matcher is the documented shape.
    Rule {
        id: "hooks-format-on-edit",
        category: RecommendationCategory::Hooks,
        title: "Format on edit",
        why: "Prettier runs on every file it can parse, so formatting never lands in your diff.",
        command: r#"{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "file=$(jq -r '.tool_input.file_path'); case \"$file\" in *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.scss|*.html|*.md|*.yml|*.yaml) npx --no-install prettier --write \"$file\";; esac"
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
        evidence: PRETTIER_CONFIG,
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
            "command": "file=$(jq -r '.tool_input.file_path'); case \"$file\" in *.py) ruff check --fix \"$file\";; *.ts|*.tsx|*.js|*.jsx) npx --no-install eslint --fix \"$file\";; esac"
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
        evidence: LINTER,
    },
    // Docs: PostToolUse again. `tsc -p` is project-wide and exits 2 for any
    // diagnostic anywhere — including TS18003 on a references-only root config —
    // so the snippet raises the blocking exit only when the report names the file
    // Claude just wrote. Otherwise one pre-existing error would wedge every write.
    Rule {
        id: "hooks-typecheck-on-edit",
        category: RecommendationCategory::Hooks,
        title: "Typecheck on edit",
        why: "Type errors in the file Claude just wrote come back to it; the rest of the project's backlog stays out of the way.",
        command: r#"{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "file=$(jq -r '.tool_input.file_path'); case \"$file\" in *.ts|*.tsx) out=$(npx --no-install tsc --noEmit -p tsconfig.json 2>&1); rel=${file#\"$PWD\"/}; if printf '%s' \"$out\" | grep -qF \"$rel\"; then printf '%s\\n' \"$out\" >&2; exit 2; fi;; esac"
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
        evidence: TSCONFIG,
    },
    // Docs: PostToolUse again; the snippet dispatches on the edited file's
    // extension, and hands the runner that one file rather than the whole suite.
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
            "command": "file=$(jq -r '.tool_input.file_path'); case \"$file\" in *.py) python -m pytest -q \"$file\";; *.ts|*.tsx|*.js|*.jsx) npx --no-install vitest related --run \"$file\";; esac"
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
        evidence: RELATED_TEST_RUNNER,
    },
];
