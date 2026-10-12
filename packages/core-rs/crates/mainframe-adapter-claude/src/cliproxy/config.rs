//! Finding and reading CLIProxyAPI's own config file. Absence is the expected steady state,
//! so every path here returns `None` rather than an error.

use std::path::PathBuf;

use super::CliProxyConfig;

/// The proxy's own default, used when the config omits `port:`.
const DEFAULT_PORT: u16 = 8317;

/// Escape hatch for installs the three standard paths miss (a moved Homebrew prefix,
/// Linux). An env var rather than a provider setting because the catalog probe runs
/// behind `Adapter::probe_models`, which has no settings access — a setting would work
/// at spawn but leave the picker empty, which is the worse half to get right.
const CONFIG_PATH_ENV: &str = "MAINFRAME_CLIPROXY_CONFIG";

fn config_candidates(override_path: Option<&str>) -> Vec<PathBuf> {
    if let Some(path) = override_path.map(str::trim).filter(|p| !p.is_empty()) {
        return vec![PathBuf::from(path)];
    }
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/etc/cliproxyapi.conf"),
        PathBuf::from("/usr/local/etc/cliproxyapi.conf"),
    ];
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".cli-proxy-api/config.yaml"));
    }
    paths
}

/// Strip a trailing `# comment` and surrounding quotes/whitespace from a YAML scalar.
fn scalar(raw: &str) -> &str {
    let value = match raw.find(" #") {
        Some(idx) => &raw[..idx],
        None => raw,
    }
    .trim();
    value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
        .unwrap_or(value)
}

/// Read the two keys we need out of the proxy's config. `packages/core-rs` carries no
/// YAML dependency and the maintained crates are thick for the job, so this reads
/// top-level `port:` and the first entry of top-level `api-keys:` directly. Indented
/// keys are ignored on purpose — `remote-management.secret-key` must never be mistaken
/// for an API key.
fn parse_config(text: &str) -> Option<CliProxyConfig> {
    let mut port = DEFAULT_PORT;
    let mut auth_token: Option<String> = None;
    let mut in_api_keys = false;

    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        let top_level = line.len() == trimmed.len();

        if in_api_keys {
            if let Some(item) = trimmed.strip_prefix("- ")
                && !top_level
            {
                let value = scalar(item);
                if !value.is_empty() {
                    auth_token = Some(value.to_string());
                }
                in_api_keys = false;
                continue;
            }
            // Any other line ends the list; an empty `api-keys:` leaves the token unset.
            in_api_keys = false;
        }
        if !top_level {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("port:") {
            port = scalar(rest).parse().unwrap_or(DEFAULT_PORT);
        } else if trimmed.starts_with("api-keys:") {
            in_api_keys = true;
        }
    }

    // `host:` is deliberately ignored: its default `""` means "bind all interfaces",
    // not a connect address.
    Some(CliProxyConfig {
        base_url: format!("http://127.0.0.1:{port}"),
        auth_token: auth_token?,
    })
}

/// First readable, parseable config wins. `None` whenever the proxy isn't installed.
pub async fn discover(override_path: Option<&str>) -> Option<CliProxyConfig> {
    let from_env = std::env::var(CONFIG_PATH_ENV).ok();
    let effective = override_path
        .filter(|p| !p.trim().is_empty())
        .or(from_env.as_deref());
    for path in config_candidates(effective) {
        if let Ok(text) = tokio::fs::read_to_string(&path).await
            && let Some(config) = parse_config(&text)
        {
            return Some(config);
        }
    }
    None
}

/// Parsing is allowed to fail silently, so these tests pin the *shape* of every failure as
/// tightly as the happy path — a parser that quietly returned the management `secret-key`
/// as an API key would look identical at runtime.
#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
