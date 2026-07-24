//! Ported from `packages/core/src/lsp/lsp-registry.ts`.
//!
//! Language-server registry: the static `id -> LspServerConfig` table, the
//! extension -> language map, and bring-your-own command resolution. The TS
//! twin resolved `typescript-language-server`/`pyright` from `node_modules`
//! bundled alongside the Node daemon (`require.resolve` + `process.execPath`);
//! the Rust daemon ships no bundled servers, so every language (including
//! `jdtls`, which was already PATH-only) resolves the same way: a project-local
//! `node_modules/.bin`, then a Python venv, then a `command -v` probe on the
//! resolved login-shell `PATH`. Fails soft — an unresolved server is `None`,
//! never an error.

use std::collections::HashMap;
use std::path::Path;

use mainframe_types::lsp::LspServerConfig;

/// A resolved spawn target: the executable plus its argv.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedCommand {
    pub command: String,
    pub args: Vec<String>,
}

fn default_configs() -> Vec<LspServerConfig> {
    vec![
        LspServerConfig {
            id: "typescript".to_string(),
            languages: vec![
                ".ts".to_string(),
                ".tsx".to_string(),
                ".js".to_string(),
                ".jsx".to_string(),
            ],
            command: "typescript-language-server".to_string(),
            args: vec!["--stdio".to_string()],
            bundled: true,
        },
        LspServerConfig {
            id: "python".to_string(),
            languages: vec![".py".to_string(), ".pyi".to_string()],
            command: "pyright-langserver".to_string(),
            args: vec!["--stdio".to_string()],
            bundled: true,
        },
        LspServerConfig {
            id: "java".to_string(),
            languages: vec![".java".to_string()],
            command: "jdtls".to_string(),
            args: vec![],
            bundled: false,
        },
    ]
}

/// The static language-server registry. Immutable after construction
/// (CONCURRENCY.tsv: `configs`/`extensionMap` are `SINGLE_TASK`, read-only).
pub struct LspRegistry {
    configs: HashMap<String, LspServerConfig>,
    /// Preserves declaration order for `get_all_language_ids` (parity with the
    /// TS insertion-ordered `Map`).
    order: Vec<String>,
    extension_map: HashMap<String, String>,
    /// Boot-resolved login-shell `PATH`, applied to the `command -v` probe and the
    /// external-server spawn so packaged builds find CLIs outside the bare launchd
    /// `PATH` (mirrors the TS `enrichPath` env mutation). `None` = inherit.
    resolved_path: Option<String>,
}

impl LspRegistry {
    pub fn new() -> Self {
        let mut configs = HashMap::new();
        let mut order = Vec::new();
        let mut extension_map = HashMap::new();
        for config in default_configs() {
            for ext in &config.languages {
                extension_map.insert(ext.clone(), config.id.clone());
            }
            order.push(config.id.clone());
            configs.insert(config.id.clone(), config);
        }
        Self {
            configs,
            order,
            extension_map,
            resolved_path: None,
        }
    }

    /// Inject the boot-resolved login-shell `PATH` (see
    /// `mainframe_runtime::ResolvedPath`) used for external-server detection and
    /// spawns.
    #[must_use]
    pub fn with_resolved_path(mut self, path: impl Into<String>) -> Self {
        self.resolved_path = Some(path.into());
        self
    }

    /// The configured login-shell `PATH`, if any.
    #[must_use]
    pub fn resolved_path(&self) -> Option<&str> {
        self.resolved_path.as_deref()
    }

    pub fn get_config(&self, language_id: &str) -> Option<&LspServerConfig> {
        self.configs.get(language_id)
    }

    pub fn get_language_for_extension(&self, ext: &str) -> Option<String> {
        self.extension_map.get(ext).cloned()
    }

    pub fn get_all_language_ids(&self) -> Vec<String> {
        self.order.clone()
    }

    /// Resolves a language's command by trying, in order: a project-local
    /// `node_modules/.bin/<cmd>`, a Python venv (project `.venv/bin` then
    /// `$VIRTUAL_ENV/bin`), then a `command -v` probe against the boot-resolved
    /// login-shell `PATH`. Fails soft — `None` when nothing resolves, never an
    /// error, so an unavailable server never blocks the caller.
    pub async fn resolve_command(
        &self,
        language_id: &str,
        project_path: &str,
    ) -> Option<ResolvedCommand> {
        let config = self.configs.get(language_id)?;
        let cmd = config.command.as_str();

        if let Some(path) = project_local_bin(project_path, cmd).await {
            return Some(ResolvedCommand {
                command: path,
                args: config.args.clone(),
            });
        }

        let virtual_env = std::env::var("VIRTUAL_ENV").ok();
        if let Some(path) = venv_bin(project_path, virtual_env.as_deref(), cmd).await {
            return Some(ResolvedCommand {
                command: path,
                args: config.args.clone(),
            });
        }

        if command_on_path(cmd, self.resolved_path.as_deref()).await {
            return Some(ResolvedCommand {
                command: config.command.clone(),
                args: config.args.clone(),
            });
        }

        tracing::debug!(
            language_id,
            cmd,
            "LSP server not found (project-local, venv, or PATH)"
        );
        None
    }
}

/// True if `path` exists, is a regular file, and (on unix) has an exec bit set.
async fn is_executable_file(path: &Path) -> bool {
    match tokio::fs::metadata(path).await {
        Ok(meta) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                meta.is_file() && meta.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                meta.is_file()
            }
        }
        Err(_) => false,
    }
}

/// `{project_path}/node_modules/.bin/<cmd>`, if present and executable. An empty
/// `project_path` (no project context, e.g. the languages-status route) always
/// misses rather than resolving against the daemon's own working directory.
async fn project_local_bin(project_path: &str, cmd: &str) -> Option<String> {
    if project_path.is_empty() {
        return None;
    }
    let candidate = Path::new(project_path)
        .join("node_modules")
        .join(".bin")
        .join(cmd);
    is_executable_file(&candidate)
        .await
        .then(|| candidate.to_string_lossy().into_owned())
}

/// `{project_path}/.venv/bin/<cmd>`, then `{virtual_env}/bin/<cmd>`. `virtual_env`
/// is passed in rather than read from the environment here so this helper is
/// directly unit-testable without mutating process env (see module docs).
async fn venv_bin(project_path: &str, virtual_env: Option<&str>, cmd: &str) -> Option<String> {
    if !project_path.is_empty() {
        let project_venv = Path::new(project_path).join(".venv").join("bin").join(cmd);
        if is_executable_file(&project_venv).await {
            return Some(project_venv.to_string_lossy().into_owned());
        }
    }
    let virtual_env = virtual_env?;
    let candidate = Path::new(virtual_env).join("bin").join(cmd);
    is_executable_file(&candidate)
        .await
        .then(|| candidate.to_string_lossy().into_owned())
}

/// `command -v <cmd>` against `resolved_path` (falls back to the inherited
/// process `PATH` when unset). Shell is needed for the `command -v` builtin, but
/// `cmd` is passed as a positional arg ($1) — never interpolated into the
/// script — so it can't be parsed as shell syntax.
async fn command_on_path(cmd: &str, resolved_path: Option<&str>) -> bool {
    let mut probe = tokio::process::Command::new("/bin/sh");
    probe.args(["-c", "command -v \"$1\"", "sh", cmd]);
    if let Some(path) = resolved_path {
        probe.env("PATH", path);
    }
    matches!(probe.output().await, Ok(out) if out.status.success())
}

impl Default for LspRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests;

// PORT STATUS: packages/core/src/lsp/lsp-registry.ts (99 lines)
// confidence: high (config table, extension map) / new (BYO resolution order)
// todos: 0
// notes: the TS twin resolved bundled servers via `require.resolve` against the
//   Node daemon's own node_modules, which has no Rust analogue and no live
//   deployment behavior worth preserving byte-for-byte (Rust ships no bundled
//   servers). `resolve_command` instead does bring-your-own discovery for every
//   language, config-driven rather than a `bundled: bool` branch: project-local
//   `node_modules/.bin`, then a Python venv, then the `command -v` PATH probe
//   `jdtls` already used. Unknown-language and PATH-probe branches are faithful.
