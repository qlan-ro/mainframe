//! Resolve `cloudflared` to an absolute path by scanning PATH so spawned tunnels
//! can be recorded and later reaped by exact binary path (never a bare name — a
//! bare match could kill an unrelated user process after PID reuse). Returns
//! `None` when cloudflared is not on PATH.

use std::path::Path;
use std::sync::Arc;

use crate::process::child_registry::BoxFuture;

/// Predicate the resolver probes each candidate with; default checks `X_OK`.
pub type IsExecutableFn = Arc<dyn Fn(String) -> BoxFuture<'static, bool> + Send + Sync>;

#[derive(Default)]
pub struct ResolveCloudflaredDeps {
    /// PATH string to scan; defaults to `PATH` from the environment.
    pub path: Option<String>,
    /// Platform selecting the binary name (`win32` → `cloudflared.exe`).
    pub platform: Option<String>,
    pub is_executable: Option<IsExecutableFn>,
}

/// Host PATH-list separator, independent of the
/// `platform` param — which only selects the binary name.
const DELIMITER: char = if cfg!(windows) { ';' } else { ':' };

async fn default_is_executable(candidate: String) -> bool {
    match tokio::fs::metadata(&candidate).await {
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
        // Not executable or missing — not a match.
        Err(_) => false,
    }
}

pub async fn resolve_cloudflared_path(deps: ResolveCloudflaredDeps) -> Option<String> {
    let path_var = deps
        .path
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_default();
    let is_win32 = match &deps.platform {
        Some(platform) => platform == "win32",
        None => cfg!(windows),
    };
    let is_executable = deps
        .is_executable
        .unwrap_or_else(|| Arc::new(|c| Box::pin(default_is_executable(c))));
    let binary = if is_win32 {
        "cloudflared.exe"
    } else {
        "cloudflared"
    };

    for dir in path_var.split(DELIMITER) {
        if dir.is_empty() {
            continue;
        }
        let candidate = Path::new(dir).join(binary).to_string_lossy().into_owned();
        if is_executable(candidate.clone()).await {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
#[path = "resolve_cloudflared_tests.rs"]
mod tests;
