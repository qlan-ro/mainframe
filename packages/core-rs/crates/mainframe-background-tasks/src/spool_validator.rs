//! Ported from `packages/core/src/background-tasks/spool-validator.ts`.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

/// Simulated host platform. Only `Win32` diverges from the POSIX path rules; the
/// TS `NodeJS.Platform` string collapses to this here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Linux,
    Darwin,
    Win32,
}

impl Platform {
    pub fn current() -> Platform {
        if cfg!(windows) {
            Platform::Win32
        } else if cfg!(target_os = "macos") {
            Platform::Darwin
        } else {
            Platform::Linux
        }
    }
}

/// `realpath(p)` — resolves a path, rejecting (ENOENT/EACCES) via `Err`.
pub type RealpathFn = Arc<
    dyn Fn(String) -> Pin<Box<dyn Future<Output = Result<String, std::io::Error>> + Send>>
        + Send
        + Sync,
>;

pub struct SpoolValidatorDeps {
    pub platform: Platform,
    pub getuid: Option<Arc<dyn Fn() -> u32 + Send + Sync>>,
    pub env: HashMap<String, String>,
    pub realpath: Option<RealpathFn>,
    pub tmpdir: Option<Arc<dyn Fn() -> String + Send + Sync>>,
}

/// The three-way outcome of a spool-path check: whether the path itself is a
/// legitimate spool location, and — if so — whether the file it names
/// currently exists. A caller maps `MissingFile` to a "no output yet" response
/// distinct from `Invalid`'s "not a spool path at all".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpoolCheck {
    Valid,
    MissingFile,
    Invalid,
}

/// A validator: `(outputPath, taskId) -> Promise<boolean>`.
pub trait SpoolValidator: Send + Sync {
    fn validate<'a>(
        &'a self,
        output_path: &'a str,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>>;

    /// Default impl maps `validate`'s bool onto `Valid`/`Invalid` — existing
    /// implementors (reconcile's test doubles) need not know about
    /// `MissingFile`. `MadeSpoolValidator` overrides this with the real
    /// three-way logic.
    fn check<'a>(
        &'a self,
        output_path: &'a str,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = SpoolCheck> + Send + 'a>> {
        Box::pin(async move {
            if self.validate(output_path, task_id).await {
                SpoolCheck::Valid
            } else {
                SpoolCheck::Invalid
            }
        })
    }
}

// --- platform-specific path helpers (parse against the SIMULATED platform, not
// the host: host POSIX `Path` cannot parse `C:\\…`). ---

fn sep(platform: Platform) -> char {
    if platform == Platform::Win32 {
        '\\'
    } else {
        '/'
    }
}

fn basename(path: &str, platform: Platform) -> &str {
    match path.rsplit_once(sep(platform)) {
        Some((_, name)) => name,
        None => path,
    }
}

fn join(a: &str, b: &str, platform: Platform) -> String {
    format!("{a}{}{b}", sep(platform))
}

/// The directory portion of `path` under the simulated platform's separator;
/// empty when `path` carries no separator.
fn parent_dir(path: &str, platform: Platform) -> &str {
    match path.rsplit_once(sep(platform)) {
        Some((dir, _)) => dir,
        None => "",
    }
}

/// root-prefix + `tasks`-segment rules, run against a resolved candidate path.
fn passes_root_and_tasks_rules(candidate: &str, root: &str, platform: Platform) -> bool {
    let s = sep(platform);
    let starts_ok = candidate == root || candidate.starts_with(&format!("{root}{s}"));
    let has_tasks_segment = candidate.split(s).any(|seg| seg == "tasks");
    starts_ok && has_tasks_segment
}

struct MadeSpoolValidator {
    platform: Platform,
    getuid: Option<Arc<dyn Fn() -> u32 + Send + Sync>>,
    env: HashMap<String, String>,
    realpath: RealpathFn,
    tmpdir: Arc<dyn Fn() -> String + Send + Sync>,
}

impl SpoolValidator for MadeSpoolValidator {
    fn validate<'a>(
        &'a self,
        output_path: &'a str,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move { self.check(output_path, task_id).await == SpoolCheck::Valid })
    }

    fn check<'a>(
        &'a self,
        output_path: &'a str,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = SpoolCheck> + Send + 'a>> {
        Box::pin(async move {
            let platform = self.platform;
            if basename(output_path, platform) != format!("{task_id}.output") {
                return SpoolCheck::Invalid;
            }

            let base_tmp_dir = match self.env.get("CLAUDE_CODE_TMPDIR") {
                Some(v) => v.clone(),
                None => {
                    if platform == Platform::Win32 {
                        (self.tmpdir)()
                    } else {
                        "/tmp".to_string()
                    }
                }
            };
            let temp_dir_name = if platform == Platform::Win32 {
                "claude".to_string()
            } else {
                match &self.getuid {
                    Some(f) => format!("claude-{}", f()),
                    None => {
                        tracing::warn!(
                            target: "background-tasks:spool",
                            %output_path,
                            "no uid source for a POSIX spool path; rejecting"
                        );
                        return SpoolCheck::Invalid;
                    }
                }
            };

            // realpath failure (ENOENT, EACCES) = path does not exist / not readable.
            let resolved_base = match (self.realpath)(base_tmp_dir).await {
                Ok(v) => v,
                Err(_) => return SpoolCheck::Invalid,
            };
            let root = join(&resolved_base, &temp_dir_name, platform);

            let resolved_output = match (self.realpath)(output_path.to_string()).await {
                Ok(v) => v,
                Err(_) => {
                    return self
                        .check_missing_output(output_path, platform, &root)
                        .await;
                }
            };

            if passes_root_and_tasks_rules(&resolved_output, &root, platform) {
                SpoolCheck::Valid
            } else {
                SpoolCheck::Invalid
            }
        })
    }
}

impl MadeSpoolValidator {
    /// `realpath(output_path)` failed. Distinguishes a dangling symlink (or
    /// any entry `realpath` couldn't resolve, still `Invalid`) from a genuinely
    /// absent file: `NotFound` on `symlink_metadata` means nothing is there at
    /// all, so the *parent* directory is resolved instead and the root/`tasks`
    /// rules run against `resolved_parent/basename` — a legitimate spool
    /// location that simply hasn't had its output file written yet.
    async fn check_missing_output(
        &self,
        output_path: &str,
        platform: Platform,
        root: &str,
    ) -> SpoolCheck {
        match tokio::fs::symlink_metadata(output_path).await {
            Ok(_) => SpoolCheck::Invalid, // e.g. a dangling symlink — something is there
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                let parent = parent_dir(output_path, platform);
                let resolved_parent = match (self.realpath)(parent.to_string()).await {
                    Ok(v) => v,
                    Err(_) => return SpoolCheck::Invalid,
                };
                let candidate = join(&resolved_parent, basename(output_path, platform), platform);
                if passes_root_and_tasks_rules(&candidate, root, platform) {
                    SpoolCheck::MissingFile
                } else {
                    SpoolCheck::Invalid
                }
            }
            Err(_) => SpoolCheck::Invalid,
        }
    }
}

#[cfg(unix)]
fn default_getuid() -> Option<Arc<dyn Fn() -> u32 + Send + Sync>> {
    Some(Arc::new(crate::spool_root::current_uid))
}

#[cfg(windows)]
fn default_getuid() -> Option<Arc<dyn Fn() -> u32 + Send + Sync>> {
    None // Windows spool paths carry no uid segment.
}

pub fn make_spool_validator(deps: SpoolValidatorDeps) -> impl SpoolValidator {
    let getuid = deps.getuid.or_else(default_getuid);
    let realpath = deps.realpath.unwrap_or_else(|| {
        Arc::new(|p: String| {
            Box::pin(async move {
                tokio::fs::canonicalize(&p)
                    .await
                    .map(|pb| pb.to_string_lossy().into_owned())
            }) as Pin<Box<dyn Future<Output = Result<String, std::io::Error>> + Send>>
        })
    });
    let tmpdir = deps
        .tmpdir
        .unwrap_or_else(|| Arc::new(|| std::env::temp_dir().to_string_lossy().into_owned()));
    MadeSpoolValidator {
        platform: deps.platform,
        getuid,
        env: deps.env,
        realpath,
        tmpdir,
    }
}

// PORT STATUS: src/background-tasks/spool-validator.ts (44 lines)
// confidence: high
// todos: 0
// notes: `path.win32`/`path.posix` simulation → local sep/basename/join keyed on
// the SIMULATED Platform (host std::path can't parse `C:\\…`). deps.realpath /
// deps.tmpdir / deps.getuid are injectable closures — the seam stays for tests
// that need to pin a uid without depending on the CI user; make_spool_validator
// now fills an absent deps.getuid with the real uid on unix (None on Windows,
// where POSIX paths simply have no uid segment to match). validator returned as
// a boxed-future trait object (SpoolValidator) so reconcile can inject test
// doubles. All 8 spool-validator.test.ts cases translated (linux/darwin/win32/
// env-override). deps.env kept as a HashMap to mirror `deps.env[...]` lookups.
