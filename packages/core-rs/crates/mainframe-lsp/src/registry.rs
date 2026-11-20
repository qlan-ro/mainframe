//! The supported language servers and how their commands are found. The
//! daemon ships no servers: each resolves from the project's
//! `node_modules/.bin`, then a Python venv, then the login-shell `PATH`. An
//! unresolved server is `None`, never an error.

use std::path::{Path, PathBuf};

use mainframe_runtime::ResolvedPath;

struct ServerSpec {
    language: &'static str,
    command: &'static str,
    args: &'static [&'static str],
}

/// In the order the languages-status route lists them.
const SERVERS: &[ServerSpec] = &[
    ServerSpec {
        language: "typescript",
        command: "typescript-language-server",
        args: &["--stdio"],
    },
    ServerSpec {
        language: "python",
        command: "pyright-langserver",
        args: &["--stdio"],
    },
    ServerSpec {
        language: "java",
        command: "jdtls",
        args: &[],
    },
];

fn spec(language: &str) -> Option<&'static ServerSpec> {
    SERVERS.iter().find(|spec| spec.language == language)
}

/// A resolved spawn target: the executable plus its argv.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedCommand {
    pub(crate) command: PathBuf,
    pub(crate) args: Vec<String>,
}

#[derive(Default)]
pub struct LspRegistry {
    /// The boot-resolved login-shell `PATH`, searched for server executables
    /// and given to the servers, so a packaged daemon started with launchd's
    /// bare `PATH` still finds them. `None` inherits the daemon's own.
    resolved_path: Option<ResolvedPath>,
}

impl LspRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn with_resolved_path(mut self, path: ResolvedPath) -> Self {
        self.resolved_path = Some(path);
        self
    }

    pub(crate) fn resolved_path(&self) -> Option<&ResolvedPath> {
        self.resolved_path.as_ref()
    }

    pub fn supports(&self, language: &str) -> bool {
        spec(language).is_some()
    }

    pub fn language_ids(&self) -> impl Iterator<Item = &'static str> {
        SERVERS.iter().map(|spec| spec.language)
    }

    /// Whether the server resolves without a project (venv or `PATH` only).
    pub async fn is_installed(&self, language: &str) -> bool {
        self.resolve_command(language, None).await.is_some()
    }

    pub(crate) async fn resolve_command(
        &self,
        language: &str,
        project: Option<&Path>,
    ) -> Option<ResolvedCommand> {
        let spec = spec(language)?;
        let virtual_env = std::env::var_os("VIRTUAL_ENV").map(PathBuf::from);
        let command = match project_bin(project, virtual_env.as_deref(), spec.command).await {
            Some(path) => path,
            None => self.find_on_path(spec.command).await?,
        };
        Some(ResolvedCommand {
            command,
            args: spec.args.iter().map(|arg| (*arg).to_owned()).collect(),
        })
    }

    /// The directory scan runs off the executor.
    async fn find_on_path(&self, command: &'static str) -> Option<PathBuf> {
        let path = self
            .resolved_path
            .clone()
            .unwrap_or_else(|| ResolvedPath::from_value(std::env::var("PATH").unwrap_or_default()));
        let found = tokio::task::spawn_blocking(move || path.find(command)).await;
        found.ok().flatten().or_else(|| {
            tracing::debug!(
                command,
                "LSP server not found in the project, a venv or PATH"
            );
            None
        })
    }
}

/// `{project}/node_modules/.bin/<command>`, then `{project}/.venv/bin/<command>`,
/// then `{virtual_env}/bin/<command>`: the first that is an executable file.
/// `virtual_env` is a parameter so tests need not mutate the process env.
async fn project_bin(
    project: Option<&Path>,
    virtual_env: Option<&Path>,
    command: &str,
) -> Option<PathBuf> {
    let project_candidates = project.into_iter().flat_map(|project| {
        [
            project.join("node_modules/.bin").join(command),
            project.join(".venv/bin").join(command),
        ]
    });
    let venv_candidate = virtual_env.map(|venv| venv.join("bin").join(command));
    for candidate in project_candidates.chain(venv_candidate) {
        if is_executable_file(&candidate).await {
            return Some(candidate);
        }
    }
    None
}

async fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    tokio::fs::metadata(path)
        .await
        .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
