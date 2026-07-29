//! Discovery is allowed to fail silently, so these tests pin the *shape* of every
//! failure as tightly as the happy path. Config parsing has its own tests in
//! `cliproxy/config.rs`; naming and ordering in `label.rs` and `order.rs`.

use super::*;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

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
    // Only the id is contractual here; the two display lines are `label.rs`'s job.
    assert_eq!(entry.label, "OpenAI - GPT 5.6 Sol");
    assert_eq!(
        entry.description.as_deref(),
        Some("GPT 5.6 Sol · Runs on your OpenAI account")
    );
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
async fn resolve_env_fails_loudly_with_an_actionable_message() {
    let error = resolve_env(Some("/nonexistent/cliproxyapi.conf"), None, "gpt-5.6-sol")
        .await
        .expect_err("no proxy");
    assert!(error.contains("brew services start cliproxyapi"), "{error}");
}
