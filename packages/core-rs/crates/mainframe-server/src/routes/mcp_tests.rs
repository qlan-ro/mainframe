//! `/mcp` over real HTTP against the assembled app: every refusal in the
//! spec's table, and a happy-path `initialize` → `tools/list` → `tools/call`.

use std::net::SocketAddr;
use std::sync::Arc;

use crate::chat_test_support::StubAdapter;
use crate::ctx::AppCtx;
use reqwest::StatusCode;
use serde_json::{Value, json};

#[path = "mcp_limit_tests.rs"]
mod limit_tests;

struct Server {
    base: String,
    ctx: Arc<AppCtx>,
}

impl Server {
    async fn start() -> Self {
        let ctx = AppCtx::test_ctx_with_orchestration();
        let app = crate::http::build_app(Arc::clone(&ctx));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let service = app.into_make_service_with_connect_info::<SocketAddr>();
            if let Err(err) = axum::serve(listener, service).await {
                panic!("test server failed: {err}");
            }
        });
        Self {
            base: format!("http://{addr}/mcp"),
            ctx,
        }
    }

    /// A chat in a fresh project plus a live credential for it.
    async fn caller(&self) -> (String, String) {
        let chats = self.ctx.chat_manager.clone().unwrap();
        self.ctx
            .adapter_registry
            .register(StubAdapter::new("claude", false));
        let dir = std::env::temp_dir().join(format!("mf-mcp-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().into_owned();
        let project = self
            .ctx
            .db
            .call(move |d| d.projects.create(&path, None))
            .await
            .unwrap();
        let chat = chats
            .create_chat(mainframe_types::chat::NewChat {
                project_id: project.id,
                adapter_id: "claude".into(),
                ..Default::default()
            })
            .await;
        let service = self.ctx.orchestration.clone().unwrap();
        let token = service.issue_launch(&chat.id, "sess-1").token;
        (chat.id, token.expose().to_string())
    }

    fn post(&self, token: Option<&str>) -> reqwest::RequestBuilder {
        let mut req = reqwest::Client::new()
            .post(&self.base)
            .header("Content-Type", "application/json");
        if let Some(token) = token {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
        req
    }
}

async fn rpc(server: &Server, token: &str, body: Value) -> (StatusCode, Value) {
    let res = server.post(Some(token)).json(&body).send().await.unwrap();
    let status = res.status();
    let text = res.text().await.unwrap();
    (status, serde_json::from_str(&text).unwrap_or(Value::Null))
}

#[tokio::test]
async fn initialize_list_and_call_capabilities() {
    let server = Server::start().await;
    let (chat_id, token) = server.caller().await;

    let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": "2025-06-18", "capabilities": {},
                    "clientInfo": { "name": "t", "version": "1" } } });
    let (status, body) = rpc(&server, &token, init).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(body["result"]["serverInfo"]["name"], "mainframe");

    let list = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" });
    let (_, body) = rpc(&server, &token, list).await;
    let names: Vec<&str> = body["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"capabilities") && names.contains(&"chat_send"));

    let call = json!({ "jsonrpc": "2.0", "id": "c", "method": "tools/call",
        "params": { "name": "capabilities", "arguments": {} } });
    let (status, body) = rpc(&server, &token, call).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], "c");
    assert_eq!(body["result"]["isError"], false);
    assert_eq!(
        body["result"]["structuredContent"]["caller"]["chatId"],
        chat_id
    );

    let unknown = json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": { "name": "nope", "arguments": {} } });
    let (_, body) = rpc(&server, &token, unknown).await;
    assert_eq!(body["error"]["code"], -32602);

    let bad_input = json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call",
        "params": { "name": "chat_read", "arguments": { "chatId": "../x" } } });
    let (_, body) = rpc(&server, &token, bad_input).await;
    assert_eq!(body["result"]["isError"], true);
    assert_eq!(
        body["result"]["structuredContent"]["error"]["code"],
        "invalid_request"
    );
}

#[tokio::test]
async fn notifications_are_accepted_and_bad_envelopes_rejected() {
    let server = Server::start().await;
    let (_, token) = server.caller().await;
    let note = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    let res = server.post(Some(&token)).json(&note).send().await.unwrap();
    assert_eq!(res.status(), StatusCode::ACCEPTED);
    assert!(res.text().await.unwrap().is_empty());

    let (status, body) = rpc(
        &server,
        &token,
        json!([{ "jsonrpc": "2.0", "id": 1, "method": "ping" }]),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], -32600);

    let res = server
        .post(Some(&token))
        .body("{oops")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["error"]["code"], -32700);
    assert_eq!(body["id"], Value::Null);
}

#[tokio::test]
async fn auth_failures_are_401_with_a_bearer_challenge() {
    let server = Server::start().await;
    let ping = json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" });
    for token in [None, Some("not-a-real-token")] {
        let res = server.post(token).json(&ping).send().await.unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        let challenge = res.headers().get("www-authenticate").unwrap();
        assert_eq!(challenge, "Bearer realm=\"mainframe\"");
    }
    let (chat_id, token) = server.caller().await;
    server.ctx.orchestration.clone().unwrap().revoke(&chat_id);
    let res = server.post(Some(&token)).json(&ping).send().await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn browser_tunnel_and_malformed_requests_are_refused() {
    let server = Server::start().await;
    let (_, token) = server.caller().await;
    let ping = json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" });

    let res = reqwest::Client::new()
        .get(&server.base)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(res.headers().get("allow").unwrap(), "POST");

    let origin = server
        .post(Some(&token))
        .header("Origin", "http://localhost:5173");
    assert_eq!(
        origin.json(&ping).send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    for header in ["Forwarded", "X-Forwarded-For", "Cf-Connecting-Ip"] {
        let req = server.post(Some(&token)).header(header, "1.2.3.4");
        assert_eq!(
            req.json(&ping).send().await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }

    let text = reqwest::Client::new()
        .post(&server.base)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "text/plain")
        .body(ping.to_string());
    assert_eq!(
        text.send().await.unwrap().status(),
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );

    let old = server
        .post(Some(&token))
        .header("MCP-Protocol-Version", "2024-11-05");
    assert_eq!(
        old.json(&ping).send().await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn responses_are_never_compressed() {
    let server = Server::start().await;
    let (_, token) = server.caller().await;
    let list = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });
    let res = server
        .post(Some(&token))
        .header("Accept-Encoding", "gzip, br")
        .json(&list)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert!(res.headers().get("content-encoding").is_none());
}

/// The mock CLI's `mcp_call` fixture step (E2E) speaks to the real route.
#[tokio::test]
async fn the_mock_clis_mcp_call_reaches_the_route_with_its_credential() {
    use mainframe_adapter_mock::mcp_call::call_tool;
    use mainframe_types::orchestration::{OrchestrationMcpLaunch, SecretToken};

    let server = Server::start().await;
    let (chat_id, token) = server.caller().await;
    let launch = OrchestrationMcpLaunch {
        url: server.base.clone(),
        token: SecretToken::new(token),
    };
    let outcome = call_tool(&launch, "capabilities", json!({})).await;
    assert!(!outcome.is_error, "{}", outcome.text);
    let result: Value = serde_json::from_str(&outcome.text).unwrap();
    assert_eq!(result["caller"]["chatId"], chat_id);

    let stale = OrchestrationMcpLaunch {
        url: server.base.clone(),
        token: SecretToken::new("revoked".into()),
    };
    let refused = call_tool(&stale, "capabilities", json!({})).await;
    assert!(refused.is_error);
    assert!(refused.text.contains("401"), "{}", refused.text);
}
