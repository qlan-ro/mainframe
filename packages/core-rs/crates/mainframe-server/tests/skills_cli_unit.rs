//! Unit-level tests for the not-yet-built `mainframe_server::skills_cli`
//! module (todo #243, plan Group A — `rust-cli-tests`, tasks A1–A3). RED
//! until Group B (`rust-cli-service`) lands `skills_cli/{mod,resolve,args,
//! validate,run,manifest,probe_parse,locks}.rs`. Do not stub the module to
//! make this compile — a module this file can't exercise proves nothing
//! about Group B's behavior.
//!
//! Contract pinned here (mirrors the plan's B1 skeleton and wire contract
//! verbatim; Group B implements exactly this):
//!
//! ```ignore
//! pub struct CommandSpec { pub program: String, pub args: Vec<String>, pub cwd: String }
//! pub struct CliOutcome { pub started: bool, pub timed_out: bool, pub exit_code: Option<i32>, pub output: String }
//! pub trait SkillsCliRunner: Send + Sync {
//!     fn run(&self, spec: CommandSpec, timeout_ms: u64) -> BoxFuture<'_, CliOutcome>;
//! }
//! pub enum SkillsCliError { Rejected(String), Busy, Cli { reason: String, tail: String, exit_code: Option<i32> } }
//! #[derive(Clone, Copy, Debug, PartialEq, Eq)]
//! pub enum Scope { Project, Global }
//! pub struct SkillsCliEntry { pub name: String, pub scope: Scope, pub source: Option<String>, pub source_type: Option<String>, pub skill_path: Option<String> }
//! pub enum ManifestOutcome { Available { entries: Vec<SkillsCliEntry> }, Unavailable { executable: String, package_runner: String } }
//! pub struct ProbedSkill { pub name: String, pub description: Option<String> }
//! pub enum ProbeOutcome { Probed { skills: Vec<ProbedSkill> }, Unparseable }
//!
//! pub async fn manifest(runner: &dyn SkillsCliRunner, path: &ResolvedPath, project_id: &str, project_path: &str) -> Result<ManifestOutcome, SkillsCliError>;
//! pub async fn probe(runner: &dyn SkillsCliRunner, path: &ResolvedPath, project_id: &str, project_path: &str, source: &str) -> Result<ProbeOutcome, SkillsCliError>;
//! pub async fn install(runner: &dyn SkillsCliRunner, path: &ResolvedPath, project_id: &str, project_path: &str, source: &str, skills: &[String], scope: Scope, adapter_id: Option<&str>) -> Result<(), SkillsCliError>;
//! pub async fn uninstall(runner: &dyn SkillsCliRunner, path: &ResolvedPath, project_id: &str, project_path: &str, skills: &[String], scope: Scope, adapter_id: Option<&str>) -> Result<(), SkillsCliError>;
//! ```
//!
//! Submodules exercised directly by later tasks: `skills_cli::validate`,
//! `skills_cli::manifest::{parse_entries, merge}`, `skills_cli::resolve::{resolve_cli, CliBinary}`,
//! `skills_cli::run::{tail, TAIL_CHARS}`, `skills_cli::probe_parse::parse_probe`,
//! `skills_cli::locks::acquire`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::VecDeque;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::sync::Mutex;

use mainframe_runtime::ResolvedPath;
use mainframe_server::skills_cli::{
    CliOutcome, CommandSpec, ManifestOutcome, ProbeOutcome, Scope, SkillsCliError, SkillsCliRunner,
};
use tempfile::TempDir;

/// Records every [`CommandSpec`] passed to `run`, and replays queued
/// [`CliOutcome`]s in order; once the queue is drained, returns a bare
/// `exit 0` success so tests that don't care about the outcome don't need
/// to queue one.
struct RecordingRunner {
    specs: Mutex<Vec<RecordedSpec>>,
    outcomes: Mutex<VecDeque<CliOutcome>>,
}

#[derive(Debug, Clone)]
struct RecordedSpec {
    program: String,
    args: Vec<String>,
    cwd: String,
}

fn success_outcome() -> CliOutcome {
    CliOutcome {
        started: true,
        timed_out: false,
        exit_code: Some(0),
        output: String::new(),
    }
}

impl RecordingRunner {
    fn new() -> Self {
        Self::queued(Vec::new())
    }

    fn queued(outcomes: Vec<CliOutcome>) -> Self {
        Self {
            specs: Mutex::new(Vec::new()),
            outcomes: Mutex::new(outcomes.into()),
        }
    }

    fn recorded(&self) -> Vec<RecordedSpec> {
        self.specs.lock().unwrap().clone()
    }
}

impl SkillsCliRunner for RecordingRunner {
    fn run(
        &self,
        spec: CommandSpec,
        _timeout_ms: u64,
    ) -> mainframe_server::skills_cli::BoxFuture<'_, CliOutcome> {
        self.specs.lock().unwrap().push(RecordedSpec {
            program: spec.program.clone(),
            args: spec.args.clone(),
            cwd: spec.cwd.clone(),
        });
        let outcome = self
            .outcomes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(success_outcome);
        Box::pin(async move { outcome })
    }
}

/// A temp dir on `PATH` holding executable stub files for each `names`
/// entry (empty shell scripts — the recording runner never actually spawns
/// them; only `resolve_cli`'s filesystem probe reads this directory).
fn executable_dir(names: &[&str]) -> (TempDir, ResolvedPath) {
    let dir = tempfile::tempdir().unwrap();
    for name in names {
        let path = dir.path().join(name);
        fs::write(&path, "#!/bin/sh\n").unwrap();
        let mut perms = fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&path, perms).unwrap();
    }
    let resolved = ResolvedPath::from_value(dir.path().to_string_lossy().into_owned());
    (dir, resolved)
}

/// `PATH` resolving the `skills` executable — the common case for the argv
/// tests below, which care about `args`/`cwd`, not which binary was chosen.
fn fake_skills_binary() -> (TempDir, ResolvedPath) {
    executable_dir(&["skills"])
}

fn owned(names: &[&str]) -> Vec<String> {
    names.iter().map(|s| s.to_string()).collect()
}

const PROJECT_ID: &str = "p1";
const PROJECT_PATH: &str = "/tmp/skills-cli-test-project";

#[tokio::test]
async fn install_argv_is_add_with_explicit_skills_agent_and_yes() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::new();

    let result = mainframe_server::skills_cli::install(
        &runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a", "b"]),
        Scope::Project,
        Some("claude"),
    )
    .await;

    assert!(result.is_ok(), "expected install to succeed: {result:?}");
    let recorded = runner.recorded();
    assert_eq!(recorded.len(), 1);
    assert_eq!(
        recorded[0].args,
        vec![
            "add",
            "owner/repo",
            "--skill",
            "a",
            "--skill",
            "b",
            "--agent",
            "claude-code",
            "--yes"
        ]
    );
    assert_eq!(recorded[0].cwd, PROJECT_PATH);
}

#[tokio::test]
async fn install_global_scope_adds_the_global_flag() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::new();

    mainframe_server::skills_cli::install(
        &runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Global,
        Some("claude"),
    )
    .await
    .unwrap();

    let recorded = runner.recorded();
    let args = &recorded[0].args;
    let global_idx = args
        .iter()
        .position(|a| a == "--global")
        .expect("--global present");
    let yes_idx = args
        .iter()
        .position(|a| a == "--yes")
        .expect("--yes present");
    assert_eq!(
        global_idx + 1,
        yes_idx,
        "--global must sit immediately before --yes"
    );
}

#[tokio::test]
async fn uninstall_argv_is_remove_with_skill_agent_scope_and_yes() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::new();

    mainframe_server::skills_cli::uninstall(
        &runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        &owned(&["a"]),
        Scope::Project,
        Some("claude"),
    )
    .await
    .unwrap();

    let recorded = runner.recorded();
    assert_eq!(recorded.len(), 1);
    assert_eq!(
        recorded[0].args,
        vec!["remove", "--skill", "a", "--agent", "claude-code", "--yes"]
    );
    assert_eq!(recorded[0].cwd, PROJECT_PATH);
}

#[tokio::test]
async fn manifest_runs_list_json_twice_once_per_scope() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::queued(vec![
        CliOutcome {
            started: true,
            timed_out: false,
            exit_code: Some(0),
            output: "[]".to_string(),
        },
        CliOutcome {
            started: true,
            timed_out: false,
            exit_code: Some(0),
            output: "[]".to_string(),
        },
    ]);

    let result =
        mainframe_server::skills_cli::manifest(&runner, &path, PROJECT_ID, PROJECT_PATH).await;

    assert!(
        matches!(result, Ok(ManifestOutcome::Available { .. })),
        "{result:?}"
    );
    let recorded = runner.recorded();
    assert_eq!(recorded.len(), 2);
    assert_eq!(recorded[0].args, vec!["list", "--json"]);
    assert_eq!(recorded[1].args, vec!["list", "--json", "--global"]);
    assert_eq!(recorded[0].cwd, PROJECT_PATH);
    assert_eq!(recorded[1].cwd, PROJECT_PATH);
}

#[tokio::test]
async fn probe_argv_is_add_source_list() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::new();

    let result =
        mainframe_server::skills_cli::probe(&runner, &path, PROJECT_ID, PROJECT_PATH, "owner/repo")
            .await;

    assert!(matches!(
        result,
        Ok(ProbeOutcome::Probed { .. } | ProbeOutcome::Unparseable)
    ));
    let recorded = runner.recorded();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].args, vec!["add", "owner/repo", "--list"]);
}

#[tokio::test]
async fn no_argv_contains_a_telemetry_or_dangerously_accept_flag() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::new();

    mainframe_server::skills_cli::install(
        &runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Project,
        Some("claude"),
    )
    .await
    .unwrap();
    mainframe_server::skills_cli::install(
        &runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Global,
        Some("claude"),
    )
    .await
    .unwrap();
    mainframe_server::skills_cli::uninstall(
        &runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        &owned(&["a"]),
        Scope::Project,
        Some("claude"),
    )
    .await
    .unwrap();
    mainframe_server::skills_cli::manifest(&runner, &path, PROJECT_ID, PROJECT_PATH)
        .await
        .unwrap();
    mainframe_server::skills_cli::probe(&runner, &path, PROJECT_ID, PROJECT_PATH, "owner/repo")
        .await
        .unwrap();

    for spec in runner.recorded() {
        for arg in &spec.args {
            assert!(
                !arg.starts_with("--metadata") && !arg.starts_with("--dangerously-accept"),
                "forbidden flag {arg:?} in {spec:?}"
            );
        }
    }
}

#[tokio::test]
async fn no_argument_derived_from_user_input_starts_with_a_dash() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::new();
    let known_flags = [
        "add",
        "--skill",
        "--agent",
        "claude-code",
        "--yes",
        "--global",
        "owner/repo",
    ];

    mainframe_server::skills_cli::install(
        &runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["my skill.v2"]),
        Scope::Project,
        Some("claude"),
    )
    .await
    .unwrap();

    let recorded = runner.recorded();
    for arg in recorded[0].args.iter().skip(1) {
        if known_flags.contains(&arg.as_str()) {
            continue;
        }
        assert!(
            !arg.starts_with('-'),
            "unexpected dash-prefixed argument {arg:?}"
        );
    }
}

#[tokio::test]
async fn unknown_adapter_falls_back_to_claude_code() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::new();

    mainframe_server::skills_cli::install(
        &runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Project,
        Some("codex"),
    )
    .await
    .unwrap();
    mainframe_server::skills_cli::install(
        &runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Project,
        None,
    )
    .await
    .unwrap();

    let recorded = runner.recorded();
    for spec in &recorded {
        let agent_idx = spec
            .args
            .iter()
            .position(|a| a == "--agent")
            .expect("--agent present");
        assert_eq!(spec.args[agent_idx + 1], "claude-code");
    }
}

// ---------------------------------------------------------------------------
// A2 — validation, manifest merge/parse, resolve, exit-mapping, probe-parse
// (spec AC 9, 10, 13; R2, R3). Group B's validate.rs, manifest.rs, resolve.rs,
// run.rs and probe_parse.rs each implement exactly the contract pinned by the
// assertions below.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn source_rejected_when_empty_dashed_local_path_or_off_allowlist() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::new();
    let invalid_sources = [
        "",
        "   ",
        "--yes",
        "-x",
        "/etc/passwd",
        "./local",
        "~/skills",
        "file:///tmp",
        "https://evil.example.com/repo",
    ];

    for source in invalid_sources {
        let result = mainframe_server::skills_cli::install(
            &runner,
            &path,
            PROJECT_ID,
            PROJECT_PATH,
            source,
            &owned(&["a"]),
            Scope::Project,
            Some("claude"),
        )
        .await;
        assert!(
            matches!(result, Err(SkillsCliError::Rejected(_))),
            "expected {source:?} to be rejected, got {result:?}"
        );
    }

    assert!(
        runner.recorded().is_empty(),
        "no CLI invocation for any rejected source"
    );
}

#[tokio::test]
async fn source_accepted_for_shorthand_https_allowlist_and_ssh() {
    let accepted_sources = [
        "owner/repo",
        "https://github.com/o/r",
        "https://gitlab.com/o/r",
        "https://github.com/o/r/tree/main/skills/x",
        "git@github.com:o/r.git",
    ];

    for source in accepted_sources {
        assert!(
            mainframe_server::skills_cli::validate::validate_source(source).is_ok(),
            "expected {source:?} to be accepted"
        );
    }
}

#[tokio::test]
async fn skill_name_allows_spaces_and_dots_and_rejects_dash_prefix_and_control_chars() {
    for accepted in ["my skill", "a.b"] {
        assert!(
            mainframe_server::skills_cli::validate::validate_skill_name(accepted).is_ok(),
            "expected {accepted:?} to be accepted"
        );
    }
    for rejected in ["-x", "a\u{7}b", ""] {
        assert!(
            mainframe_server::skills_cli::validate::validate_skill_name(rejected).is_err(),
            "expected {rejected:?} to be rejected"
        );
    }
}

#[tokio::test]
async fn manifest_merges_project_and_global_entries() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::queued(vec![
        CliOutcome {
            started: true,
            timed_out: false,
            exit_code: Some(0),
            output: r#"{"shadcn":{"source":"shadcn/ui","sourceType":"github","skillPath":"skills/shadcn/SKILL.md"}}"#
                .to_string(),
        },
        CliOutcome {
            started: true,
            timed_out: false,
            exit_code: Some(0),
            output: r#"[{"name":"playwright","source":"owner/pw","sourceType":"github","skillPath":"skills/playwright/SKILL.md"}]"#
                .to_string(),
        },
    ]);

    let result =
        mainframe_server::skills_cli::manifest(&runner, &path, PROJECT_ID, PROJECT_PATH).await;

    let ManifestOutcome::Available { entries } = result.unwrap() else {
        panic!("expected an available manifest");
    };
    assert_eq!(entries.len(), 2);
    let shadcn = entries
        .iter()
        .find(|e| e.name == "shadcn")
        .expect("shadcn entry present");
    assert_eq!(shadcn.scope, Scope::Project);
    let playwright = entries
        .iter()
        .find(|e| e.name == "playwright")
        .expect("playwright entry present");
    assert_eq!(playwright.scope, Scope::Global);
}

#[tokio::test]
async fn manifest_parses_the_lockfile_shaped_object_and_the_array_shape() {
    let lockfile_shape = r#"{
        "shadcn": {"source":"shadcn/ui","sourceType":"github","skillPath":"skills/shadcn/SKILL.md"},
        "playwright": {"source":"owner/pw","sourceType":"github","skillPath":"skills/playwright/SKILL.md"}
    }"#;
    let array_shape = r#"[
        {"name":"shadcn","source":"shadcn/ui","sourceType":"github","skillPath":"skills/shadcn/SKILL.md"},
        {"name":"playwright","source":"owner/pw","sourceType":"github","skillPath":"skills/playwright/SKILL.md"},
        {"source":"no-name/repo"}
    ]"#;

    let from_lockfile_shape =
        mainframe_server::skills_cli::manifest::parse_entries(lockfile_shape, Scope::Project);
    let from_array_shape =
        mainframe_server::skills_cli::manifest::parse_entries(array_shape, Scope::Project);

    let mut lockfile_names: Vec<&str> = from_lockfile_shape
        .iter()
        .map(|e| e.name.as_str())
        .collect();
    lockfile_names.sort_unstable();
    let mut array_names: Vec<&str> = from_array_shape.iter().map(|e| e.name.as_str()).collect();
    array_names.sort_unstable();

    assert_eq!(lockfile_names, vec!["playwright", "shadcn"]);
    assert_eq!(array_names, vec!["playwright", "shadcn"]);
    assert_eq!(
        from_array_shape.len(),
        2,
        "the no-name entry must be dropped, not defaulted"
    );
}

#[tokio::test]
async fn manifest_reports_unavailable_when_neither_binary_resolves() {
    let empty_dir = tempfile::tempdir().unwrap();
    let path = ResolvedPath::from_value(empty_dir.path().to_string_lossy().into_owned());
    let runner = RecordingRunner::new();

    let result =
        mainframe_server::skills_cli::manifest(&runner, &path, PROJECT_ID, PROJECT_PATH).await;

    assert!(
        matches!(
            result,
            Ok(ManifestOutcome::Unavailable { ref executable, ref package_runner })
                if executable == "skills" && package_runner == "npx skills"
        ),
        "{result:?}"
    );
    assert!(runner.recorded().is_empty(), "runner must never be invoked");
}

#[tokio::test]
async fn manifest_prefers_the_skills_executable_over_the_package_runner() {
    let (_skills_dir, skills_path) = executable_dir(&["skills"]);
    let (_npx_dir, npx_path) = executable_dir(&["npx"]);

    let skills_binary =
        mainframe_server::skills_cli::resolve::resolve_cli(&skills_path).expect("skills resolves");
    assert_eq!(skills_binary.program, "skills");
    assert!(skills_binary.prefix.is_empty());

    let npx_binary =
        mainframe_server::skills_cli::resolve::resolve_cli(&npx_path).expect("npx resolves");
    assert_eq!(npx_binary.program, "npx");
    assert_eq!(npx_binary.prefix, vec!["skills".to_string()]);
}

#[tokio::test]
async fn nonzero_exit_maps_to_a_failure_carrying_the_ansi_stripped_tail() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::queued(vec![CliOutcome {
        started: true,
        timed_out: false,
        exit_code: Some(1),
        output: "\u{1b}[2K\u{1b}[1Ginstalling…\nerror: boom\n".to_string(),
    }]);

    let result = mainframe_server::skills_cli::install(
        &runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Project,
        Some("claude"),
    )
    .await;

    match result {
        Err(SkillsCliError::Cli {
            tail, exit_code, ..
        }) => {
            assert_eq!(exit_code, Some(1));
            assert!(tail.contains("error: boom"), "{tail:?}");
            assert!(
                !tail.contains('\u{1b}'),
                "tail must be ANSI-stripped: {tail:?}"
            );
        }
        other => panic!("expected a Cli failure, got {other:?}"),
    }
}

#[tokio::test]
async fn spawn_failure_and_timeout_map_to_failures_with_their_own_reasons() {
    let (_dir, path) = fake_skills_binary();

    let spawn_failure_runner = RecordingRunner::queued(vec![CliOutcome {
        started: false,
        timed_out: false,
        exit_code: None,
        output: String::new(),
    }]);
    let spawn_result = mainframe_server::skills_cli::install(
        &spawn_failure_runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Project,
        Some("claude"),
    )
    .await;

    let timeout_runner = RecordingRunner::queued(vec![CliOutcome {
        started: true,
        timed_out: true,
        exit_code: None,
        output: "partial".to_string(),
    }]);
    let timeout_result = mainframe_server::skills_cli::install(
        &timeout_runner,
        &path,
        PROJECT_ID,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Project,
        Some("claude"),
    )
    .await;

    let Err(SkillsCliError::Cli {
        reason: spawn_reason,
        ..
    }) = spawn_result
    else {
        panic!("expected a Cli failure for the spawn error, got {spawn_result:?}");
    };
    let Err(SkillsCliError::Cli {
        reason: timeout_reason,
        ..
    }) = timeout_result
    else {
        panic!("expected a Cli failure for the timeout, got {timeout_result:?}");
    };
    assert_ne!(spawn_reason, timeout_reason);
    assert!(!spawn_reason.is_empty());
    assert!(!timeout_reason.is_empty());
}

#[tokio::test]
async fn tail_is_capped() {
    let huge = "x".repeat(100 * 1024);
    let capped = mainframe_server::skills_cli::run::tail(
        &huge,
        mainframe_server::skills_cli::run::TAIL_CHARS,
    );
    assert!(capped.chars().count() <= mainframe_server::skills_cli::run::TAIL_CHARS);
}

#[tokio::test]
async fn probe_parse_reads_name_description_pairs_and_reports_unparseable_otherwise() {
    let readable = "shadcn — Generate UI components with shadcn/ui\nplaywright — Browser automation and testing\n";
    let outcome = mainframe_server::skills_cli::probe_parse::parse_probe(readable);
    let ProbeOutcome::Probed { skills } = outcome else {
        panic!("expected a probed outcome for readable output");
    };
    assert_eq!(skills.len(), 2);
    assert_eq!(skills[0].name, "shadcn");
    assert_eq!(
        skills[0].description.as_deref(),
        Some("Generate UI components with shadcn/ui")
    );
    assert_eq!(skills[1].name, "playwright");

    let garbage = "###@@@\n???\n";
    assert!(matches!(
        mainframe_server::skills_cli::probe_parse::parse_probe(garbage),
        ProbeOutcome::Unparseable
    ));
}

#[tokio::test]
async fn probe_with_no_skills_is_probed_with_an_empty_list_not_unparseable() {
    let ansi_only_output = "\u{1b}[2K\u{1b}[1G";
    let outcome = mainframe_server::skills_cli::probe_parse::parse_probe(ansi_only_output);
    assert!(
        matches!(outcome, ProbeOutcome::Probed { ref skills } if skills.is_empty()),
        "{outcome:?}"
    );
}

// ---------------------------------------------------------------------------
// A3 — per-project concurrency guard (spec AC 10; D3). Group B's locks.rs
// implements exactly the module-level DashSet + RAII guard contract pinned
// below: `acquire(project_id) -> Option<Guard>`, refusing a second
// concurrent operation for the same project id and releasing on drop.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn second_operation_for_the_same_project_is_refused_while_one_is_in_flight() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::new();
    let project_id = "guard-project-in-flight";

    let _held =
        mainframe_server::skills_cli::locks::acquire(project_id).expect("first acquire succeeds");

    let result = mainframe_server::skills_cli::install(
        &runner,
        &path,
        project_id,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Project,
        Some("claude"),
    )
    .await;

    assert!(
        matches!(result, Err(SkillsCliError::Busy)),
        "expected a Busy refusal while the project is held, got {result:?}"
    );
    assert!(
        runner.recorded().is_empty(),
        "the CLI must never run while the project is busy"
    );
}

#[tokio::test]
async fn a_different_project_is_not_blocked() {
    let (_dir, path) = fake_skills_binary();
    let runner = RecordingRunner::new();

    let _held = mainframe_server::skills_cli::locks::acquire("guard-project-a")
        .expect("first acquire succeeds");

    let result = mainframe_server::skills_cli::install(
        &runner,
        &path,
        "guard-project-b",
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Project,
        Some("claude"),
    )
    .await;

    assert!(
        !matches!(result, Err(SkillsCliError::Busy)),
        "an unrelated project's guard must not block this one, got {result:?}"
    );
    assert_eq!(
        runner.recorded().len(),
        1,
        "the CLI runs once the unrelated project's operation proceeds"
    );
}

#[tokio::test]
async fn the_guard_is_released_when_the_operation_finishes_and_when_it_fails() {
    let (_dir, path) = fake_skills_binary();
    let succeeding_project = "guard-project-success";
    let failing_project = "guard-project-failure";

    let success_runner = RecordingRunner::queued(vec![success_outcome()]);
    mainframe_server::skills_cli::install(
        &success_runner,
        &path,
        succeeding_project,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Project,
        Some("claude"),
    )
    .await
    .expect("install succeeds");
    assert!(
        mainframe_server::skills_cli::locks::acquire(succeeding_project).is_some(),
        "the guard must be released after a successful operation"
    );

    let failing_runner = RecordingRunner::queued(vec![CliOutcome {
        started: true,
        timed_out: false,
        exit_code: Some(1),
        output: "error: boom".to_string(),
    }]);
    let failed = mainframe_server::skills_cli::install(
        &failing_runner,
        &path,
        failing_project,
        PROJECT_PATH,
        "owner/repo",
        &owned(&["a"]),
        Scope::Project,
        Some("claude"),
    )
    .await;
    assert!(
        matches!(failed, Err(SkillsCliError::Cli { .. })),
        "expected the queued nonzero exit to surface as a Cli error, got {failed:?}"
    );
    assert!(
        mainframe_server::skills_cli::locks::acquire(failing_project).is_some(),
        "the guard must be released after a failed operation too"
    );
}
