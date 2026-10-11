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
    let config = parse_config("port: not-a-number\napi-keys:\n  - key\n").expect("config parses");
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
