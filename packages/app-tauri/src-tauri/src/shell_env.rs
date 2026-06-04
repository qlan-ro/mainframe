/// Login-shell environment capture (C1 requirement).
///
/// Mirrors `packages/desktop/src/main/index.ts:resolveShellEnv()`.
/// Runs `$SHELL -lic env` (default `/bin/zsh`) with a 5-second timeout,
/// parses KEY=VALUE lines, and returns the full env map.
/// On failure, returns a fallback that prepends common user-level PATH
/// locations the bare launchd env omits.
use std::collections::HashMap;
use std::io::BufRead;
use std::process::{Command, Stdio};
use std::time::Duration;

const SHELL_ENV_TIMEOUT: Duration = Duration::from_secs(5);

/// The fallback extra PATH entries when the login-shell invocation fails.
/// Mirrors the Electron desktop `extra` array.
fn fallback_extra_paths(home: &str) -> Vec<String> {
    vec![
        format!("{home}/.local/bin"),
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
    ]
}

/// Capture the user's login-shell environment.
///
/// Returns a map that should be merged over `std::env::vars()` before
/// spawning the daemon sidecar (same as `startDaemon`'s `{ ...process.env, ...shellEnv }`).
pub fn resolve_shell_env() -> HashMap<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        tracing::warn!("SHELL not set in process env, defaulting to /bin/zsh");
        "/bin/zsh".to_string()
    });

    tracing::info!(shell = %shell, "resolving login-shell environment");

    match capture_shell_env(&shell) {
        Ok(env) if env.contains_key("PATH") => {
            tracing::info!(
                keys = env.len(),
                path = %env.get("PATH").map(|s| s.as_str()).unwrap_or(""),
                "login-shell env captured"
            );
            env
        }
        Ok(_) => {
            tracing::warn!(shell = %shell, "login-shell env parse succeeded but PATH missing — using fallback");
            build_fallback_env()
        }
        Err(err) => {
            tracing::warn!(%err, shell = %shell, "login-shell env capture failed — using fallback");
            build_fallback_env()
        }
    }
}

fn capture_shell_env(shell: &str) -> Result<HashMap<String, String>, String> {
    // Call output() directly — the real timeout is enforced by the outer
    // resolve_shell_env_with_timeout() thread + recv_timeout(5s). A second
    // inner thread here was pointless indirection.
    let output = Command::new(shell)
        .args(["-lic", "env"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("failed to spawn shell: {e}"))?;

    if !output.status.success() && output.stdout.is_empty() {
        return Err(format!(
            "shell exited {:?} with no output",
            output.status.code()
        ));
    }

    parse_env_output(&output.stdout)
}

fn parse_env_output(raw: &[u8]) -> Result<HashMap<String, String>, String> {
    let mut env = HashMap::new();
    for line in raw.lines() {
        let line = line.map_err(|e| format!("env output read error: {e}"))?;
        if let Some(eq) = line.find('=') {
            if eq == 0 {
                continue; // skip lines that start with '='
            }
            let key = line[..eq].to_string();
            let val = line[eq + 1..].to_string();
            env.insert(key, val);
        }
    }
    Ok(env)
}

fn build_fallback_env() -> HashMap<String, String> {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| std::env::var("HOME").unwrap_or_default());

    let current_path = std::env::var("PATH")
        .unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".to_string());

    let seen: std::collections::HashSet<&str> = current_path.split(':').collect();
    let extras = fallback_extra_paths(&home);
    let additions: Vec<&str> = extras
        .iter()
        .filter(|p| !seen.contains(p.as_str()))
        .map(|s| s.as_str())
        .collect();

    let new_path = if additions.is_empty() {
        current_path.clone()
    } else {
        format!("{}:{}", additions.join(":"), current_path)
    };

    tracing::info!(path = %new_path, "using fallback PATH");

    let mut env = HashMap::new();
    env.insert("PATH".to_string(), new_path);
    env
}

// ── timeout wrapper ───────────────────────────────────────────────────────────

/// Wraps `resolve_shell_env` with the 5-second timeout.
/// The thread-based impl above has no signal-based kill of the child; for the
/// spike this is acceptable — in production use the `fix-path-env` crate.
pub fn resolve_shell_env_with_timeout() -> HashMap<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        let env = resolve_shell_env();
        let _ = tx.send(env);
    });

    match rx.recv_timeout(SHELL_ENV_TIMEOUT) {
        Ok(env) => env,
        Err(_) => {
            tracing::warn!("login-shell env timed out after 5s — using fallback");
            build_fallback_env()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_env_output_basic() {
        let raw = b"PATH=/usr/bin:/bin\nHOME=/Users/test\nFOO=bar=baz\n";
        let env = parse_env_output(raw).unwrap();
        assert_eq!(env["PATH"], "/usr/bin:/bin");
        assert_eq!(env["HOME"], "/Users/test");
        assert_eq!(env["FOO"], "bar=baz"); // values with '=' preserved
    }

    #[test]
    fn parse_env_output_skips_leading_eq() {
        let raw = b"=INVALID\nVALID=yes\n";
        let env = parse_env_output(raw).unwrap();
        assert!(!env.contains_key(""));
        assert_eq!(env["VALID"], "yes");
    }

    #[test]
    fn fallback_env_contains_homebrew() {
        let env = build_fallback_env();
        let path = env.get("PATH").unwrap();
        assert!(
            path.contains("/opt/homebrew/bin") || path.contains("/usr/local/bin"),
            "fallback PATH missing homebrew: {path}"
        );
    }
}
