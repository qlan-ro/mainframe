use mainframe_runtime::fs::{is_within_base, resolve_and_validate_path};
use std::path::{Path, PathBuf};

/// Allow reading files under `~/.claude/` (plans, skills, …) when the path
/// resolves outside the project directory. Mirrors `resolveClaudeConfigPath`.
pub(crate) async fn resolve_claude_config_path(
    base_path: &str,
    requested_path: &str,
) -> Option<String> {
    let claude_dir = tokio::fs::canonicalize(claude_dir()?).await.ok()?;
    let joined = Path::new(base_path).join(requested_path);
    let full_path = tokio::fs::canonicalize(&joined).await.ok()?;
    is_within_base(&claude_dir, &full_path).then(|| path_to_string(&full_path))
}

/// Resolve a requested path for reading: validated inside the project base, or —
/// as a fallback — under `~/.claude/` or a Codex global instruction file.
pub(crate) async fn resolve_readable_path(base_path: &str, requested_path: &str) -> Option<String> {
    match resolve_and_validate_path(base_path, requested_path).await {
        Some(p) => Some(p),
        None => {
            if let Some(path) = resolve_claude_config_path(base_path, requested_path).await {
                return Some(path);
            }
            let config = std::env::var_os("CODEX_HOME")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))?;
            resolve_codex_instruction_path(base_path, requested_path, &config).await
        }
    }
}

async fn resolve_codex_instruction_path(
    base: &str,
    requested: &str,
    config: &Path,
) -> Option<String> {
    let config = tokio::fs::canonicalize(config).await.ok()?;
    let target = tokio::fs::canonicalize(Path::new(base).join(requested))
        .await
        .ok()?;
    ["AGENTS.md", "AGENTS.override.md"]
        .into_iter()
        .any(|name| target == config.join(name))
        .then(|| path_to_string(&target))
}

fn claude_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

fn path_to_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[cfg(test)]
#[path = "path_utils_tests.rs"]
mod tests;
