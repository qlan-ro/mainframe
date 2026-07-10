//! Ported from `packages/core/src/lsp/lsp-registry.ts`.
//!
//! Language-server registry: the static `id -> LspServerConfig` table, the
//! extension -> language map, and command resolution (bundled bin path vs.
//! `command -v` PATH probe for external servers).

use std::collections::HashMap;
use std::path::PathBuf;

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

/// Maps bundled language IDs to their npm package name and bin path within that package.
fn bundled_bin_entry(language_id: &str) -> Option<(&'static str, &'static str)> {
    match language_id {
        "typescript" => Some(("typescript-language-server", "lib/cli.mjs")),
        "python" => Some(("pyright", "dist/pyright-langserver.js")),
        _ => None,
    }
}

/// Errors resolving a bundled server's on-disk bin path.
#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("No bundled bin map entry for '{0}'")]
    NoBundledEntry(String),
    /// The daemon has not been told where the bundled `node` binary and
    /// `node_modules` live. The TS twin used `require.resolve` + `process.execPath`;
    /// the Rust daemon must inject these at boot from the packaging layout.
    #[error("Bundled LSP packaging not configured (node exec / bundled root unset)")]
    PackagingUnconfigured,
}

/// The static language-server registry. Immutable after construction
/// (CONCURRENCY.tsv: `configs`/`extensionMap` are `SINGLE_TASK`, read-only).
pub struct LspRegistry {
    configs: HashMap<String, LspServerConfig>,
    /// Preserves declaration order for `get_all_language_ids` (parity with the
    /// TS insertion-ordered `Map`).
    order: Vec<String>,
    extension_map: HashMap<String, String>,
    /// Path to the `node` binary that runs bundled JS servers (was `process.execPath`).
    node_exec: Option<String>,
    /// Directory containing the bundled `node_modules` (was `require.resolve` root).
    bundled_root: Option<PathBuf>,
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
            node_exec: None,
            bundled_root: None,
        }
    }

    /// Inject the packaging locations for bundled node servers. The TS twin got
    /// these implicitly from `process.execPath` + `require.resolve`; the Rust
    /// daemon supplies them from its packaging layout at boot.
    // TODO(port): wire this from the daemon/Tauri packaging (bundled node sidecar
    // + bundled node_modules dir) once the sidecar layout is finalized.
    pub fn with_bundled(
        mut self,
        node_exec: impl Into<String>,
        bundled_root: impl Into<PathBuf>,
    ) -> Self {
        self.node_exec = Some(node_exec.into());
        self.bundled_root = Some(bundled_root.into());
        self
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

    fn resolve_bundled_bin_path(&self, language_id: &str) -> Result<PathBuf, RegistryError> {
        let (pkg, bin) = bundled_bin_entry(language_id)
            .ok_or_else(|| RegistryError::NoBundledEntry(language_id.to_string()))?;
        let root = self
            .bundled_root
            .as_ref()
            .ok_or(RegistryError::PackagingUnconfigured)?;
        Ok(root.join(pkg).join(bin))
    }

    pub async fn resolve_command(&self, language_id: &str) -> Option<ResolvedCommand> {
        let config = self.configs.get(language_id)?;

        if config.bundled {
            let node_exec = match &self.node_exec {
                Some(exec) => exec.clone(),
                None => {
                    tracing::warn!(language_id, "Bundled LSP server package not found");
                    return None;
                }
            };
            match self.resolve_bundled_bin_path(language_id) {
                Ok(bin_path) => {
                    let mut args = vec![bin_path.to_string_lossy().to_string()];
                    args.extend(config.args.iter().cloned());
                    return Some(ResolvedCommand {
                        command: node_exec,
                        args,
                    });
                }
                Err(err) => {
                    tracing::warn!(language_id, %err, "Bundled LSP server package not found");
                    return None;
                }
            }
        }

        // Shell is needed for the `command -v` builtin, but the command must be a
        // positional arg ($1) — never interpolated into the script — so it can't be
        // parsed as shell syntax.
        match tokio::process::Command::new("/bin/sh")
            .args(["-c", "command -v \"$1\"", "sh", &config.command])
            .output()
            .await
        {
            Ok(out) if out.status.success() => Some(ResolvedCommand {
                command: config.command.clone(),
                args: config.args.clone(),
            }),
            Ok(_) | Err(_) => {
                tracing::debug!(language_id, cmd = %config.command, "External LSP server not found on PATH");
                None
            }
        }
    }
}

impl Default for LspRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests;

// PORT STATUS: packages/core/src/lsp/lsp-registry.ts (99 lines)
// confidence: high (config table, extension map, external `command -v` probe)
// todos: 1 (with_bundled packaging injection — see TODO(port) above)
// notes: `resolveBundledBinPath`/`process.execPath` have no Node analogue in Rust;
//   the bundled node binary + node_modules root are injected via `with_bundled`
//   instead of `require.resolve`. Unknown-language and external-probe branches are
//   faithful. Log strings preserved ("Bundled LSP server package not found",
//   "External LSP server not found on PATH").
