//! Discovery is allowed to fail silently, so these tests pin the *shape* of every
//! failure as tightly as the happy path — a parser that quietly returned the
//! management `secret-key` as an API key would look identical at runtime.

use super::*;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// The config Homebrew ships, trimmed to the blocks that matter. The nested
/// `secret-key` is load-bearing: it sits between the top-level keys we read.
const REAL_CONFIG: &str = r#"
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

#[test]
fn debug_never_prints_the_token() {
    let config = CliProxyConfig {
        base_url: "http://127.0.0.1:8317".to_string(),
        auth_token: "sk-super-secret".to_string(),
    };
    let rendered = format!("{config:?}");
    assert!(!rendered.contains("sk-super-secret"), "{rendered}");
    assert!(rendered.contains("<redacted>"), "{rendered}");

    let env = CliProxyEnv {
        base_url: config.base_url.clone(),
        auth_token: "sk-super-secret".to_string(),
        small_fast_model: "gpt-5.4-mini".to_string(),
    };
    let rendered = format!("{env:?}");
    assert!(!rendered.contains("sk-super-secret"), "{rendered}");
    assert!(rendered.contains("gpt-5.4-mini"), "{rendered}");
}

#[test]
fn split_endpoint_round_trips_and_leaves_native_ids_alone() {
    assert_eq!(
        split_endpoint(&namespaced("gpt-5.6-sol")),
        (Some("cliproxy"), "gpt-5.6-sol")
    );
    assert_eq!(split_endpoint("claude-opus-5"), (None, "claude-opus-5"));
    assert_eq!(split_endpoint("default"), (None, "default"));
    // A bare prefix names no model, so it stays native rather than becoming an
    // endpoint session with an empty --model.
    assert_eq!(split_endpoint("cliproxy/"), (None, "cliproxy/"));
    // Some other provider's slash-id is not ours.
    assert_eq!(
        split_endpoint("openrouter/gpt-4"),
        (None, "openrouter/gpt-4")
    );
}

#[test]
fn small_fast_model_prefers_the_override_then_the_list_then_the_selection() {
    let catalog = vec![
        model("kimi-k2.7-code-highspeed"),
        model("gpt-5.3-codex-spark"),
    ];
    assert_eq!(
        pick_small_fast_model(&catalog, Some("my-own-model"), "gpt-5.6-sol"),
        "my-own-model"
    );
    // Preference order wins over catalog order.
    assert_eq!(
        pick_small_fast_model(&catalog, None, "gpt-5.6-sol"),
        "gpt-5.3-codex-spark"
    );
    assert_eq!(
        pick_small_fast_model(&[model("kimi-k3")], None, "kimi-k3"),
        "kimi-k3"
    );
    // A blank setting is not a choice.
    assert_eq!(
        pick_small_fast_model(&catalog, Some("  "), "gpt-5.6-sol"),
        "gpt-5.3-codex-spark"
    );
}

#[test]
fn adapter_models_are_namespaced_grouped_and_carry_no_claude_capabilities() {
    let models = to_adapter_models(&[ProxyModel {
        id: "gpt-5.6-sol".to_string(),
        owned_by: Some("openai".to_string()),
    }]);

    let entry = models.first().expect("one model");
    assert_eq!(entry.id, "cliproxy/gpt-5.6-sol");
    assert_eq!(entry.label, "gpt-5.6-sol");
    assert_eq!(entry.description.as_deref(), Some("openai"));
    assert_eq!(entry.group.as_deref(), Some("CLIProxyAPI"));
    // Effort/fast/thinking are Claude flags the proxy's models do not honour, and
    // is_default must never move the picker's default off the native catalog.
    assert_eq!(entry.supported_efforts, None);
    assert_eq!(entry.supports_fast, None);
    assert_eq!(entry.supports_adaptive_thinking, None);
    assert_eq!(entry.context_window, None);
    assert_eq!(entry.is_default, None);
    assert_eq!(entry.is_older, None);
}

fn model(id: &str) -> ProxyModel {
    ProxyModel {
        id: id.to_string(),
        owned_by: None,
    }
}

/// Minimal one-shot HTTP server: reads the request headers, replies, exits.
/// Returns the base url and the `Authorization` header the client sent.
async fn stub_server(
    status_line: &'static str,
    body: &'static str,
) -> (String, tokio::task::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut request = Vec::new();
        let mut buf = [0u8; 1024];
        while !request.windows(4).any(|w| w == b"\r\n\r\n") {
            match socket.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => request.extend_from_slice(&buf[..n]),
            }
        }
        let response = format!(
            "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.flush().await;
        String::from_utf8_lossy(&request).to_string()
    });
    (format!("http://127.0.0.1:{port}"), handle)
}

fn config_for(base_url: String) -> CliProxyConfig {
    CliProxyConfig {
        base_url,
        auth_token: "test-token".to_string(),
    }
}

#[tokio::test]
async fn fetch_models_returns_chat_models_and_drops_image_models() {
    let body = r#"{"object":"list","data":[
        {"id":"gpt-5.6-sol","object":"model","owned_by":"openai"},
        {"id":"gpt-image-1.5","object":"model","owned_by":"openai"},
        {"id":"gpt-image-2","object":"model","owned_by":"openai"},
        {"id":"kimi-k3","object":"model","owned_by":"moonshot"}
    ]}"#;
    let (base_url, server) = stub_server("HTTP/1.1 200 OK", body).await;

    let models = fetch_models(&config_for(base_url)).await.expect("models");

    assert_eq!(
        models,
        vec![
            ProxyModel {
                id: "gpt-5.6-sol".to_string(),
                owned_by: Some("openai".to_string())
            },
            ProxyModel {
                id: "kimi-k3".to_string(),
                owned_by: Some("moonshot".to_string())
            },
        ]
    );
    let request = server.await.expect("server");
    assert!(request.starts_with("GET /v1/models "), "{request}");
    assert!(
        request.contains("authorization: Bearer test-token"),
        "{request}"
    );
}

#[tokio::test]
async fn fetch_models_returns_none_when_the_proxy_rejects_the_key() {
    let (base_url, server) = stub_server(
        "HTTP/1.1 401 Unauthorized",
        r#"{"error":{"message":"invalid key"}}"#,
    )
    .await;
    assert!(fetch_models(&config_for(base_url)).await.is_none());
    let _ = server.await;
}

#[tokio::test]
async fn fetch_models_returns_none_when_nothing_is_listening() {
    // Bind then drop, so the port is almost certainly free and definitely unbound.
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);

    let config = config_for(format!("http://127.0.0.1:{port}"));
    assert!(fetch_models(&config).await.is_none());
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

#[tokio::test]
async fn resolve_env_fails_loudly_with_an_actionable_message() {
    let error = resolve_env(Some("/nonexistent/cliproxyapi.conf"), None, "gpt-5.6-sol")
        .await
        .expect_err("no proxy");
    assert!(error.contains("brew services start cliproxyapi"), "{error}");
}
