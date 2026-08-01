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
    CliOutcome, CommandSpec, ManifestOutcome, ProbeOutcome, Scope, SkillsCliRunner,
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
