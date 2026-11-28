/// Login-shell environment capture (C1 requirement).
///
/// Runs `$SHELL -lic env` (default `/bin/zsh`), parses KEY=VALUE lines, and
/// returns the full env map. When the capture fails, callers use
/// [`build_fallback_env`], which prepends common user-level PATH locations the
/// bare launchd env omits.
///
/// The shell runs as an interactive login shell (`-i` as well as `-l`) on
/// purpose. Without `-i`, zsh skips `.zshrc` and bash skips `.bashrc`, and that
/// is where nvm, bun, pnpm, pyenv, conda and similar installers add their PATH
/// entries — so `claude` or `codex` installed through one of them would not be
/// found by the daemon. The interactive start-up is the slow part, which is why
/// callers ([`crate::env_boot`]) never block the window on it and start the
/// daemon from a cached capture.
use std::collections::HashMap;
use std::io::{BufRead, Read};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub mod cache;

pub type Env = HashMap<String, String>;

/// How long a single capture may run before the shell is killed. Only the
/// background refresh waits this long; the daemon waits at most
/// [`crate::env_boot::DAEMON_ENV_WAIT`].
pub const SHELL_KILL_AFTER: Duration = Duration::from_secs(30);

const CAPTURE_POLL: Duration = Duration::from_millis(20);
/// After the shell exits, how long to wait for its stdout to drain. A process
/// the rc files started in the background can keep the pipe open.
const STDOUT_DRAIN: Duration = Duration::from_secs(2);

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

/// The user's login shell: `$SHELL`, else `/bin/zsh`.
pub fn login_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            tracing::warn!("SHELL not set in process env, defaulting to /bin/zsh");
            "/bin/zsh".to_string()
        })
}

/// Capture the login-shell environment of `shell`.
///
/// Returns an error when the shell cannot be spawned, is killed after
/// `kill_after`, prints nothing, or prints no `PATH`. The returned map is
/// merged over the process env before spawning the daemon sidecar.
pub fn capture_login_env(shell: &str, kill_after: Duration) -> Result<Env, String> {
    let env = capture_shell_env(shell, kill_after)?;
    if !env.get("PATH").is_some_and(|p| !p.is_empty()) {
        return Err("login-shell env has no PATH".to_string());
    }
    Ok(env)
}

fn capture_shell_env(shell: &str, kill_after: Duration) -> Result<Env, String> {
    let mut child = Command::new(shell)
        .args(["-lic", "env"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn shell: {e}"))?;

    // Drain stdout on its own thread so a large env never fills the pipe while
    // this thread polls for exit.
    let mut stdout = child.stdout.take().ok_or("shell stdout was not piped")?;
    let (out_tx, out_rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("shell-env-stdout".into())
        .spawn(move || {
            let mut buf = Vec::new();
            let _ = stdout.read_to_end(&mut buf);
            let _ = out_tx.send(buf);
        })
        .map_err(|e| format!("failed to start stdout reader: {e}"))?;

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < kill_after => std::thread::sleep(CAPTURE_POLL),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "shell still running after {}s, killed",
                    kill_after.as_secs()
                ));
            }
            Err(e) => return Err(format!("waiting for shell failed: {e}")),
        }
    };

    let stdout = out_rx
        .recv_timeout(STDOUT_DRAIN)
        .map_err(|_| "shell exited but its stdout stayed open".to_string())?;

    if !status.success() && stdout.is_empty() {
        return Err(format!("shell exited {:?} with no output", status.code()));
    }

    parse_env_output(&stdout)
}

fn parse_env_output(raw: &[u8]) -> Result<Env, String> {
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

/// The env used when no login-shell capture is available: the process PATH
/// with common user-level tool directories prepended.
pub fn build_fallback_env() -> Env {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| std::env::var("HOME").unwrap_or_default());

    let current_path =
        std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".to_string());

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

    let mut env = HashMap::new();
    env.insert("PATH".to_string(), new_path);
    env
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

    #[cfg(unix)]
    #[test]
    fn capture_kills_a_shell_that_never_finishes() {
        let dir = crate::env_boot::test_support::scratch_dir("kill");
        let shell = crate::env_boot::test_support::fake_shell(&dir, 8, "PATH=/never");
        let started = Instant::now();

        let err =
            capture_login_env(shell.to_str().unwrap(), Duration::from_millis(300)).unwrap_err();

        assert!(err.contains("killed"), "unexpected error: {err}");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "capture outlived its kill deadline"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn capture_rejects_an_env_without_path() {
        let dir = crate::env_boot::test_support::scratch_dir("nopath");
        let shell = crate::env_boot::test_support::fake_shell(&dir, 0, "ONLY=this");

        let err = capture_login_env(shell.to_str().unwrap(), SHELL_KILL_AFTER).unwrap_err();

        assert!(err.contains("no PATH"), "unexpected error: {err}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
