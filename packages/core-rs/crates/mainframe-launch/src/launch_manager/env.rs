use super::*;

fn is_allowed_env_var(key: &str) -> bool {
    if ENV_ALLOWLIST_EXACT.contains(key) {
        return true;
    }
    ENV_ALLOWLIST_PREFIXES.iter().any(|p| key.starts_with(p))
}

/// Build a minimal env for launched processes — only essential OS/user vars.
///
/// The standalone launcher prepends its bundled-node bin dir to PATH so the
/// daemon can find its bundled Node/cloudflared; that prefix must never reach
/// user launch processes (they'd resolve `node`/`npm` to Mainframe's internal
/// single-file Node instead of the user's toolchain). `MAINFRAME_ORIG_PATH`
/// carries the pristine, pre-prefix PATH and is itself never forwarded.
pub fn clean_env(source: &HashMap<String, String>) -> HashMap<String, String> {
    let mut result: HashMap<String, String> = HashMap::new();
    for (key, value) in source {
        if key == "MAINFRAME_ORIG_PATH" {
            continue;
        }
        if is_allowed_env_var(key) {
            result.insert(key.clone(), value.clone());
        }
    }
    if let Some(orig_path) = source.get("MAINFRAME_ORIG_PATH")
        && !orig_path.is_empty()
    {
        result.insert("PATH".to_string(), orig_path.clone());
    }
    result
}

/// Compose a launch child's env exactly as `start` does: inject the boot-resolved
/// login-shell `PATH` into the daemon's
/// process env, then run `clean_env`. When `MAINFRAME_ORIG_PATH` is present it
/// still overrides the injected `PATH` inside `clean_env` (the standalone
/// contract); when absent the resolved `PATH` reaches the child.
pub(super) fn compose_launch_env(
    mut source: HashMap<String, String>,
    resolved_path: Option<&str>,
) -> HashMap<String, String> {
    if let Some(path) = resolved_path {
        source.insert("PATH".to_string(), path.to_string());
    }
    clean_env(&source)
}
