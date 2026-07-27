//! Behavioral tests for the hooks snippets.
//!
//! A hook's exit code is Claude Code's control channel — PreToolUse 2 blocks the
//! tool, PostToolUse 2 feeds stderr back as a blocking error — so a test that
//! only reads the command string proves nothing. These run each snippet under
//! `sh` against stub `jq`/`npx`/`ruff`/`python` binaries and assert on the exit
//! code and on which tool the snippet actually reached for.

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Stdio};

use mainframe_types::setup_advisor::RecommendationCategory;
use tempfile::TempDir;

use super::super::all;

/// Records its argv into `$MF_LOG`, then emits `$MF_STDOUT` and exits
/// `$MF_EXIT` — enough to stand in for any tool the snippets invoke.
const RECORDING_STUB: &str = r#"#!/bin/sh
printf '%s %s\n' "$(basename "$0")" "$*" >> "$MF_LOG"
if [ -n "$MF_STDOUT" ]; then printf '%s\n' "$MF_STDOUT"; fi
exit "${MF_EXIT:-0}"
"#;

/// Every snippet reads the edited path the same way, so the stub ignores the
/// filter it was handed and answers with the path under test.
const JQ_STUB: &str = r#"#!/bin/sh
cat > /dev/null
printf '%s\n' "$MF_FILE"
"#;

struct Harness {
    root: TempDir,
}

struct Outcome {
    code: i32,
    log: String,
}

impl Outcome {
    fn invoked(&self, needle: &str) -> bool {
        self.log.contains(needle)
    }
}

impl Harness {
    fn new() -> Self {
        let root = TempDir::new().unwrap();
        let bin = root.path().join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(root.path().join("project/src")).unwrap();
        write_stub(&bin.join("jq"), JQ_STUB);
        for tool in ["npx", "ruff", "python"] {
            write_stub(&bin.join(tool), RECORDING_STUB);
        }
        Self { root }
    }

    fn project(&self) -> std::path::PathBuf {
        // macOS hands out `/var/...` tempdirs that resolve to `/private/var/...`;
        // the typecheck snippet strips `$PWD` off the edited path, and `$PWD` is
        // whatever `sh` gets from `getcwd`.
        fs::canonicalize(self.root.path().join("project")).unwrap()
    }

    /// Runs `rule_id`'s snippet as if Claude had just edited `edited`, with the
    /// stubbed tools exiting `tool_exit` after printing `tool_stdout`.
    fn run(&self, rule_id: &str, edited: &str, tool_exit: i32, tool_stdout: &str) -> Outcome {
        let project = self.project();
        let log = self.root.path().join(format!("{rule_id}.log"));
        fs::write(&log, "").unwrap();
        let path = format!(
            "{}:{}",
            self.root.path().join("bin").display(),
            std::env::var("PATH").unwrap_or_default()
        );

        let mut child = Command::new("sh")
            .arg("-c")
            .arg(snippet(rule_id))
            .current_dir(&project)
            .env("PATH", path)
            .env("PWD", &project)
            .env("MF_LOG", &log)
            .env("MF_FILE", project.join(edited))
            .env("MF_EXIT", tool_exit.to_string())
            .env("MF_STDOUT", tool_stdout)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(br#"{"tool_input":{"file_path":"x"}}"#)
            .unwrap();

        Outcome {
            code: child.wait().unwrap().code().unwrap(),
            log: fs::read_to_string(&log).unwrap(),
        }
    }
}

fn write_stub(path: &Path, body: &str) {
    fs::write(path, body).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

/// The shell one-liner buried in a rule's `settings.json` snippet. Every hooks
/// rule ships exactly one.
fn snippet(rule_id: &str) -> String {
    let rule = all()
        .into_iter()
        .find(|rule| rule.id == rule_id)
        .unwrap_or_else(|| panic!("no rule `{rule_id}`"));
    let parsed: serde_json::Value = serde_json::from_str(rule.command).unwrap();
    let mut found: Vec<String> = Vec::new();
    for event in parsed["hooks"].as_object().unwrap().values() {
        for matcher in event.as_array().unwrap() {
            for hook in matcher["hooks"].as_array().unwrap() {
                found.push(hook["command"].as_str().unwrap().to_string());
            }
        }
    }
    assert_eq!(found.len(), 1, "{rule_id} ships {} snippets", found.len());
    found.remove(0)
}

#[test]
fn block_edits_stops_a_write_to_an_env_file() {
    let outcome = Harness::new().run("hooks-block-edits", ".env", 0, "");

    assert_eq!(outcome.code, 2, "PreToolUse 2 is what blocks the tool call");
}

#[test]
fn block_edits_lets_an_ordinary_source_file_through() {
    let outcome = Harness::new().run("hooks-block-edits", "src/app.ts", 0, "");

    assert_eq!(outcome.code, 0);
}

/// `prettier --write main.py` exits 2 on a parser it has no plugin for, and a
/// PostToolUse 2 is a blocking error — so an unguarded formatter breaks every
/// Python, Rust, and Go edit in the project.
#[test]
fn format_on_edit_leaves_a_python_file_alone_instead_of_failing_prettier_on_it() {
    let outcome = Harness::new().run("hooks-format-on-edit", "main.py", 2, "");

    assert_eq!(outcome.code, 0);
    assert!(
        outcome.log.is_empty(),
        "prettier should never have been invoked; log was {:?}",
        outcome.log
    );
}

#[test]
fn format_on_edit_formats_a_typescript_file() {
    let outcome = Harness::new().run("hooks-format-on-edit", "src/app.ts", 0, "");

    assert_eq!(outcome.code, 0);
    assert!(outcome.invoked("prettier --write"), "log: {}", outcome.log);
}

#[test]
fn lint_on_edit_reaches_for_ruff_on_python_and_eslint_on_typescript() {
    let harness = Harness::new();

    let python = harness.run("hooks-lint-on-edit", "main.py", 0, "");
    assert!(python.invoked("ruff check --fix"), "log: {}", python.log);

    let typescript = harness.run("hooks-lint-on-edit", "src/app.ts", 0, "");
    assert!(
        typescript.invoked("eslint --fix"),
        "log: {}",
        typescript.log
    );
}

/// The wedge this guards: `tsc --noEmit` exits 2 for the whole project, so one
/// unrelated pre-existing error would block every write from then on.
#[test]
fn typecheck_on_edit_does_not_block_on_an_error_in_another_file() {
    let outcome = Harness::new().run(
        "hooks-typecheck-on-edit",
        "src/app.ts",
        2,
        "src/other.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.",
    );

    assert_eq!(
        outcome.code, 0,
        "an error Claude did not just write must not block the write"
    );
}

#[test]
fn typecheck_on_edit_blocks_on_an_error_in_the_file_that_was_just_edited() {
    let outcome = Harness::new().run(
        "hooks-typecheck-on-edit",
        "src/app.ts",
        2,
        "src/app.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.",
    );

    assert_eq!(outcome.code, 2);
}

/// A solution-style root `tsconfig.json` (only `references`, no `files`) makes
/// `tsc -p` exit 2 with TS18003 on a perfectly healthy project.
#[test]
fn typecheck_on_edit_does_not_block_when_the_config_has_no_inputs() {
    let outcome = Harness::new().run(
        "hooks-typecheck-on-edit",
        "src/app.ts",
        2,
        "error TS18003: No inputs were found in config file 'tsconfig.json'.",
    );

    assert_eq!(outcome.code, 0);
}

#[test]
fn typecheck_on_edit_ignores_an_edit_to_a_file_tsc_does_not_own() {
    let outcome = Harness::new().run("hooks-typecheck-on-edit", "main.py", 2, "");

    assert_eq!(outcome.code, 0);
    assert!(
        outcome.log.is_empty(),
        "tsc should never have been invoked; log was {:?}",
        outcome.log
    );
}

/// Without a path argument `pytest` runs the entire suite on every edit, which
/// is neither "related" nor fast enough to sit in a PostToolUse hook.
#[test]
fn run_related_tests_hands_pytest_the_file_that_was_edited() {
    let harness = Harness::new();
    let outcome = harness.run("hooks-run-related-tests", "src/thing.py", 0, "");

    let edited = harness.project().join("src/thing.py");
    assert!(
        outcome.invoked(&format!("pytest -q {}", edited.display())),
        "log: {}",
        outcome.log
    );
}

#[test]
fn run_related_tests_hands_vitest_the_file_that_was_edited() {
    let harness = Harness::new();
    let outcome = harness.run("hooks-run-related-tests", "src/app.ts", 0, "");

    let edited = harness.project().join("src/app.ts");
    assert!(
        outcome.invoked(&format!("vitest related --run {}", edited.display())),
        "log: {}",
        outcome.log
    );
}

/// A hook runs without a TTY. Bare `npx` on a missing package prompts to install
/// it, gets no answer, and fails — so every invocation pins `--no-install`.
#[test]
fn every_npx_invocation_refuses_to_install_on_the_fly() {
    for rule in all()
        .into_iter()
        .filter(|rule| rule.category == RecommendationCategory::Hooks)
    {
        for (index, _) in rule.command.match_indices("npx ") {
            assert!(
                rule.command[index..].starts_with("npx --no-install "),
                "{}: bare npx at byte {index}",
                rule.id
            );
        }
    }
}
