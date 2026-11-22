use super::test_support::Server;
use serde_json::{Value, json};

#[tokio::test]
async fn external_client_initializes_without_a_running_parent_chat() {
    let s = Server::start().await;
    let grant = s.grant("control", "default").await;
    let token = grant["token"].as_str().unwrap();
    let body = s
        .rpc(token, "initialize", json!({"protocolVersion":"2025-06-18"}))
        .await;
    assert_eq!(body["result"]["serverInfo"]["name"], "mainframe-external");
    assert_eq!(body["result"]["protocolVersion"], "2025-06-18");
    let body = s.rpc(token, "tools/list", json!({})).await;
    let names: Vec<_> = body["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "capabilities",
            "project_list",
            "chat_list",
            "chat_read",
            "chat_wait",
            "chat_launch",
            "chat_send",
            "chat_interrupt",
            "chat_configure"
        ]
    );
    let list: Value = reqwest::get(format!("{}/api/external-mcp/clients", s.base))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!list.to_string().contains(token));
    assert!(!list.to_string().contains("tokenHash"));
    assert!(list["data"]["clients"][0]["lastUsedAt"].is_string());
}

#[tokio::test]
async fn internal_tokens_do_not_cross_endpoints() {
    let s = Server::start().await;
    let grant = s.grant("read", "default").await;
    let token = grant["token"].as_str().unwrap();
    let internal = s
        .ctx
        .chat
        .orchestration
        .issue_launch(&s.chat, "session-test");
    assert_eq!(
        s.post(internal.token.expose())
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        reqwest::Client::new()
            .post(format!("{}/mcp", s.base))
            .bearer_auth(token)
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
}

#[tokio::test]
async fn revocation_invalidates_the_key() {
    let s = Server::start().await;
    let grant = s.grant("read", "default").await;
    let token = grant["token"].as_str().unwrap();
    let id = grant["client"]["id"].as_str().unwrap();
    assert_eq!(
        reqwest::Client::new()
            .delete(format!("{}/api/external-mcp/clients/{id}", s.base))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        s.post(token)
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        s.post("wrong")
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
}

#[tokio::test]
async fn refuses_browser_tunnel_and_rebound_host_requests() {
    let s = Server::start().await;
    let grant = s.grant("read", "default").await;
    let token = grant["token"].as_str().unwrap();
    for (name, value) in [
        ("origin", "http://evil.example"),
        ("origin", "http://localhost:3000"),
        ("forwarded", "for=127.0.0.1"),
        ("x-forwarded-for", "127.0.0.1"),
        ("cf-connecting-ip", "1.2.3.4"),
        ("host", "evil.example"),
    ] {
        assert_eq!(
            s.post(token)
                .header(name, value)
                .json(&json!({}))
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    assert_eq!(
        reqwest::Client::new()
            .post(format!("{}/api/external-mcp/clients", s.base))
            .header("origin", "https://evil.example")
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
}

#[tokio::test]
async fn enforces_mcp_protocol_envelopes_and_content_type() {
    let s = Server::start().await;
    let grant = s.grant("read", "default").await;
    let token = grant["token"].as_str().unwrap();
    assert_eq!(s.post(token).body("{}").send().await.unwrap().status(), 415);
    assert_eq!(
        s.post(token)
            .json(&json!([]))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        s.post(token)
            .header("mcp-protocol-version", "invalid")
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        s.post(token)
            .json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
            .send()
            .await
            .unwrap()
            .status(),
        202
    );
    assert_eq!(
        s.post(token)
            .json(&json!({"data":"x".repeat(131_073)}))
            .send()
            .await
            .unwrap()
            .status(),
        413
    );
}

#[tokio::test]
async fn notification_calls_are_acknowledged_without_invoking_tools() {
    let s = Server::start().await;
    let grant = s.grant("read", "default").await;
    let token = grant["token"].as_str().unwrap();
    let notification = json!({"jsonrpc":"2.0","method":"tools/call","params":{"name":"chat_launch","arguments":{}}});
    assert_eq!(
        s.post(token)
            .json(&notification)
            .send()
            .await
            .unwrap()
            .status(),
        202
    );
}
