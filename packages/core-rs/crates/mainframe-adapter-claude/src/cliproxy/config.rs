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
mod tests {
    use super::*;

    /// The config Homebrew ships, trimmed to the blocks that matter. The nested
    /// `secret-key` is load-bearing: it sits between the top-level keys we read.
    pub const REAL_CONFIG: &str = r#"
# Server host/interface to bind to. Default is empty ("") to bind all interfaces.
host: "127.0.0.1"

# Server port
port: 8317

tls:
  enable: false
  cert: ""
  key: ""

remote-management:
  allow-remote: false
  secret-key: ""

auth-dir: "~/.cli-proxy-api"

# API keys for authentication
api-keys:
  - "ddd31f47720eb5ba25182fd1b61d19d9beebd294ef5125ff"
"#;

    #[test]
    fn parses_the_shipped_config() {
        let config = parse_config(REAL_CONFIG).expect("config parses");
        assert_eq!(config.base_url, "http://127.0.0.1:8317");
        assert_eq!(
            config.auth_token,
            "ddd31f47720eb5ba25182fd1b61d19d9beebd294ef5125ff"
        );
    }

    #[test]
    fn takes_the_first_of_several_api_keys() {
        let config = parse_config("port: 9000\napi-keys:\n  - \"first\"\n  - \"second\"\n")
            .expect("config parses");
        assert_eq!(config.auth_token, "first");
        assert_eq!(config.base_url, "http://127.0.0.1:9000");
    }

    #[test]
    fn never_reads_the_nested_management_secret_as_an_api_key() {
        let text = "remote-management:\n  secret-key: \"hunter2\"\n  api-keys:\n    - \"nested\"\n";
        assert!(parse_config(text).is_none());
    }

    #[test]
    fn an_empty_api_keys_list_is_not_a_config() {
        assert!(parse_config("port: 8317\napi-keys:\nauth-dir: \"~/x\"\n").is_none());
        assert!(parse_config("port: 8317\n").is_none());
    }

    #[test]
    fn garbage_is_not_a_config() {
        assert!(parse_config("").is_none());
        assert!(parse_config("\u{0}\u{1}not yaml at all").is_none());
    }

    #[test]
    fn a_missing_port_falls_back_to_the_proxys_own_default() {
        let config = parse_config("api-keys:\n  - key\n").expect("config parses");
        assert_eq!(config.base_url, "http://127.0.0.1:8317");
    }

    #[test]
    fn an_unparseable_port_falls_back_rather_than_dropping_the_config() {
        let config =
            parse_config("port: not-a-number\napi-keys:\n  - key\n").expect("config parses");
        assert_eq!(config.base_url, "http://127.0.0.1:8317");
    }

    #[tokio::test]
    async fn discover_reads_the_override_path_and_ignores_the_system_paths() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("cliproxyapi.conf");
        tokio::fs::write(&path, REAL_CONFIG).await.expect("write");

        let config = discover(Some(path.to_str().expect("utf8")))
            .await
            .expect("discovered");
        assert_eq!(config.base_url, "http://127.0.0.1:8317");

        assert!(
            discover(Some("/nonexistent/cliproxyapi.conf"))
                .await
                .is_none()
        );
        // A blank override falls through to the system probe rather than pinning "".
        assert_eq!(
            config_candidates(Some("   ")).len(),
            config_candidates(None).len()
        );
    }
}
