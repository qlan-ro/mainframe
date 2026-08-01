//! Skills-CLI service (todo #243): install/uninstall skills via the `skills`
//! CLI, spawned on the daemon host. Split into submodules to keep every file
//! under the 300-line/50-line limits; see the plan's Group B
//! (`rust-cli-service`) task list for the file-by-file breakdown.
//!
//! Each entry point validates input, resolves the CLI binary
//! ([`resolve::resolve_cli`]), builds the argv ([`args`]), runs it
//! ([`run::map_outcome`]) and maps the outcome. Only the two mutating
//! entry points, [`install`] and [`uninstall`], take the per-project
//! concurrency guard ([`locks::acquire`]) — `manifest`/`probe` only read, so
//! they don't need to serialize against each other or against an in-flight
//! install/uninstall. `routes/skills_cli.rs` is the only caller outside this
//! module and its tests.

use mainframe_runtime::ResolvedPath;

pub mod args;
pub mod locks;
pub mod manifest;
pub mod probe_parse;
pub mod resolve;
pub mod run;
pub mod validate;

pub use run::ProcessRunner;

/// A boxed, `Send` future — the runner trait's return type can't name
/// `impl Future` (a trait method), so it's boxed like the three other
/// crate-level precedents (`mainframe-adapter-api`, `mainframe-automations`,
/// `mainframe-launch`).
pub type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// One CLI invocation: program, argv (never a shell string), and cwd.
#[derive(Debug, Clone)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
}

/// The raw result of running a [`CommandSpec`]: whether the process started,
/// whether it hit the timeout, its exit code (`None` on spawn failure, a
/// timeout, or a signal), and the combined stdout+stderr.
#[derive(Debug, Clone)]
pub struct CliOutcome {
    pub started: bool,
    pub timed_out: bool,
    pub exit_code: Option<i32>,
    pub output: String,
}

/// The runner seam: production wiring passes [`ProcessRunner`]; tests pass a
/// recording double. Not an `AppCtx` field — constructed per call from
/// `ctx.resolved_path`, since it carries no state beyond the `PATH`.
pub trait SkillsCliRunner: Send + Sync {
    fn run(&self, spec: CommandSpec, timeout_ms: u64) -> BoxFuture<'_, CliOutcome>;
}

/// Failure outcomes the four entry points can return.
#[derive(Debug)]
pub enum SkillsCliError {
    /// Rejected input (source/skill-name/scope/empty-skills) — never reaches
    /// the CLI runner.
    Rejected(String),
    /// A second operation for this project is already in flight.
    Busy,
    /// The CLI itself failed: nonzero exit, spawn failure, or timeout.
    Cli {
        reason: String,
        tail: String,
        exit_code: Option<i32>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    Project,
    Global,
}

#[derive(Debug, Clone)]
pub struct SkillsCliEntry {
    pub name: String,
    pub scope: Scope,
    pub source: Option<String>,
    pub source_type: Option<String>,
    pub skill_path: Option<String>,
}

#[derive(Debug)]
pub enum ManifestOutcome {
    Available {
        entries: Vec<SkillsCliEntry>,
    },
    Unavailable {
        executable: String,
        package_runner: String,
    },
}

#[derive(Debug, Clone)]
pub struct ProbedSkill {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug)]
pub enum ProbeOutcome {
    Probed { skills: Vec<ProbedSkill> },
    Unparseable,
}

fn unresolved_cli_error() -> SkillsCliError {
    SkillsCliError::Cli {
        reason: "Neither the skills executable nor npx resolves on the daemon host".to_string(),
        tail: String::new(),
        exit_code: None,
    }
}

async fn run_command(
    runner: &dyn SkillsCliRunner,
    binary: &resolve::CliBinary,
    project_path: &str,
    mut args: Vec<String>,
    timeout_ms: u64,
) -> Result<String, SkillsCliError> {
    let mut full_args = binary.prefix.clone();
    full_args.append(&mut args);
    let spec = CommandSpec {
        program: binary.program.clone(),
        args: full_args,
        cwd: project_path.to_string(),
    };
    run::map_outcome(runner.run(spec, timeout_ms).await)
}

pub async fn manifest(
    runner: &dyn SkillsCliRunner,
    path: &ResolvedPath,
    _project_id: &str,
    project_path: &str,
) -> Result<ManifestOutcome, SkillsCliError> {
    let Some(binary) = resolve::resolve_cli(path) else {
        return Ok(ManifestOutcome::Unavailable {
            executable: "skills".to_string(),
            package_runner: "npx skills".to_string(),
        });
    };
    let project_raw = run_command(
        runner,
        &binary,
        project_path,
        args::list_args(Scope::Project),
        run::READ_TIMEOUT_MS,
    )
    .await?;
    let global_raw = run_command(
        runner,
        &binary,
        project_path,
        args::list_args(Scope::Global),
        run::READ_TIMEOUT_MS,
    )
    .await?;
    let entries = manifest::merge(
        manifest::parse_entries(&project_raw, Scope::Project),
        manifest::parse_entries(&global_raw, Scope::Global),
    );
    Ok(ManifestOutcome::Available { entries })
}

pub async fn probe(
    runner: &dyn SkillsCliRunner,
    path: &ResolvedPath,
    _project_id: &str,
    project_path: &str,
    source: &str,
) -> Result<ProbeOutcome, SkillsCliError> {
    validate::validate_source(source).map_err(SkillsCliError::Rejected)?;
    let Some(binary) = resolve::resolve_cli(path) else {
        return Err(unresolved_cli_error());
    };
    let raw = run_command(
        runner,
        &binary,
        project_path,
        args::probe_args(source),
        run::READ_TIMEOUT_MS,
    )
    .await?;
    Ok(probe_parse::parse_probe(&raw))
}

// The 8-argument signature is pinned by tests/skills_cli_unit.rs's doc
// comment (Group A's contract); a params struct would diverge from it.
#[allow(clippy::too_many_arguments)]
pub async fn install(
    runner: &dyn SkillsCliRunner,
    path: &ResolvedPath,
    project_id: &str,
    project_path: &str,
    source: &str,
    skills: &[String],
    scope: Scope,
    adapter_id: Option<&str>,
) -> Result<(), SkillsCliError> {
    let _guard = locks::acquire(project_id).ok_or(SkillsCliError::Busy)?;
    validate::validate_source(source).map_err(SkillsCliError::Rejected)?;
    validate_skills(skills)?;
    let Some(binary) = resolve::resolve_cli(path) else {
        return Err(unresolved_cli_error());
    };
    let agent = args::agent_for_adapter(adapter_id);
    let argv = args::add_args(source, skills, agent, scope);
    run_command(runner, &binary, project_path, argv, run::INSTALL_TIMEOUT_MS).await?;
    Ok(())
}

pub async fn uninstall(
    runner: &dyn SkillsCliRunner,
    path: &ResolvedPath,
    project_id: &str,
    project_path: &str,
    skills: &[String],
    scope: Scope,
    adapter_id: Option<&str>,
) -> Result<(), SkillsCliError> {
    let _guard = locks::acquire(project_id).ok_or(SkillsCliError::Busy)?;
    validate_skills(skills)?;
    let Some(binary) = resolve::resolve_cli(path) else {
        return Err(unresolved_cli_error());
    };
    let agent = args::agent_for_adapter(adapter_id);
    let argv = args::remove_args(skills, agent, scope);
    run_command(runner, &binary, project_path, argv, run::INSTALL_TIMEOUT_MS).await?;
    Ok(())
}

fn validate_skills(skills: &[String]) -> Result<(), SkillsCliError> {
    if skills.is_empty() {
        return Err(SkillsCliError::Rejected(
            "At least one skill is required".to_string(),
        ));
    }
    for skill in skills {
        validate::validate_skill_name(skill).map_err(SkillsCliError::Rejected)?;
    }
    Ok(())
}
