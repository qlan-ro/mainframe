//! Ported from `src/tunnel/resolve-cloudflared.ts`.
//!
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

/// Host PATH-list separator (`node:path`'s `delimiter`), independent of the
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
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn recording(
        f: impl Fn(&str) -> bool + Send + Sync + 'static,
    ) -> (IsExecutableFn, Arc<Mutex<Vec<String>>>) {
        let seen = Arc::new(Mutex::new(vec![]));
        let sink = seen.clone();
        let is_exec: IsExecutableFn = Arc::new(move |candidate: String| {
            sink.lock().unwrap().push(candidate.clone());
            let result = f(&candidate);
            Box::pin(async move { result })
        });
        (is_exec, seen)
    }

    #[tokio::test]
    async fn returns_the_first_path_entry_that_holds_an_executable_cloudflared() {
        let (is_executable, _seen) = recording(|p| p == "/opt/homebrew/bin/cloudflared");
        let result = resolve_cloudflared_path(ResolveCloudflaredDeps {
            path: Some("/usr/bin:/opt/homebrew/bin:/sbin".to_string()),
            platform: Some("darwin".to_string()),
            is_executable: Some(is_executable),
        })
        .await;
        assert_eq!(result.as_deref(), Some("/opt/homebrew/bin/cloudflared"));
    }

    #[tokio::test]
    async fn prefers_earlier_path_entries() {
        let (is_executable, _seen) = recording(|_| true);
        let result = resolve_cloudflared_path(ResolveCloudflaredDeps {
            path: Some("/home/user/.mainframe/bin/bin:/opt/homebrew/bin".to_string()),
            platform: Some("linux".to_string()),
            is_executable: Some(is_executable),
        })
        .await;
        assert_eq!(
            result.as_deref(),
            Some("/home/user/.mainframe/bin/bin/cloudflared")
        );
    }

    #[tokio::test]
    async fn returns_none_when_cloudflared_is_not_found() {
        let (is_executable, _seen) = recording(|_| false);
        let result = resolve_cloudflared_path(ResolveCloudflaredDeps {
            path: Some("/usr/bin:/bin".to_string()),
            platform: Some("darwin".to_string()),
            is_executable: Some(is_executable),
        })
        .await;
        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn looks_for_cloudflared_exe_on_win32() {
        let (is_executable, seen) = recording(|_| false);
        resolve_cloudflared_path(ResolveCloudflaredDeps {
            path: Some("C:\\bin;C:\\tools".to_string()),
            platform: Some("win32".to_string()),
            is_executable: Some(is_executable),
        })
        .await;
        let seen = seen.lock().unwrap();
        assert!(!seen.is_empty());
        assert!(seen.iter().all(|p| p.ends_with("cloudflared.exe")));
    }

    #[tokio::test]
    async fn ignores_empty_path_segments_without_probing_them() {
        let (is_executable, seen) = recording(|_| false);
        resolve_cloudflared_path(ResolveCloudflaredDeps {
            path: Some("::/usr/bin:".to_string()),
            platform: Some("linux".to_string()),
            is_executable: Some(is_executable),
        })
        .await;
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0], "/usr/bin/cloudflared");
    }
}

// PORT STATUS: src/tunnel/resolve-cloudflared.ts (40 lines)
// confidence: high
// todos: 0
// notes: scans PATH (host DELIMITER, ':' on unix — the platform param only picks
// the binary name, matching the TS `delimiter` host constant) for an executable
// `cloudflared[.exe]`. Default X_OK check = metadata + unix exec-bit. is_executable
// is an injectable async predicate; all resolve-cloudflared.test.ts cases ported.
