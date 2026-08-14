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

/// A validator: `(outputPath, taskId) -> Promise<boolean>`.
pub trait SpoolValidator: Send + Sync {
    fn validate<'a>(
        &'a self,
        output_path: &'a str,
        task_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>>;
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
        Box::pin(async move {
            let platform = self.platform;
            if basename(output_path, platform) != format!("{task_id}.output") {
                return false;
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
                        return false;
                    }
                }
            };

            // realpath failure (ENOENT, EACCES) = path does not exist / not readable.
            let resolved_base = match (self.realpath)(base_tmp_dir).await {
                Ok(v) => v,
                Err(_) => return false,
            };
            let resolved_output = match (self.realpath)(output_path.to_string()).await {
                Ok(v) => v,
                Err(_) => return false,
            };

            let root = join(&resolved_base, &temp_dir_name, platform);
            let s = sep(platform);
            let starts_ok =
                resolved_output == root || resolved_output.starts_with(&format!("{root}{s}"));
            let has_tasks_segment = resolved_output.split(s).any(|seg| seg == "tasks");
            starts_ok && has_tasks_segment
        })
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
