use super::test_support::{Server, request, until};
use mainframe_types::{chat::MessageContent, content::LeafContent};
use serde_json::{Value, json};

/// A `chat_wait` on the server's chat by client `id`, returned once the wait
/// is blocked on the chat.
async fn blocked_wait(s: &Server, token: &str, id: &str) -> tokio::task::JoinHandle<Value> {
    let (base, token, chat) = (s.base.clone(), token.to_owned(), s.chat.clone());
    let waiting = tokio::spawn(async move {
        reqwest::Client::new()
            .post(format!("{base}/mcp/external"))
            .bearer_auth(token)
            .json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call",
                "params":{"name":"chat_wait","arguments":{"chatId":chat}}}))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()
    });
    until(|| super::wait::held(id) == 1).await;
    for _ in 0..100 {
        tokio::task::yield_now().await;
    }
    assert_eq!(super::wait::held(id), 1);
    assert!(!waiting.is_finished());
    waiting
}

async fn finished(waiting: tokio::task::JoinHandle<Value>) -> Value {
    let done = tokio::time::timeout(std::time::Duration::from_secs(5), waiting)
        .await
        .unwrap()
        .unwrap();
    done["result"]["structuredContent"].clone()
}

#[tokio::test]
async fn wait_returns_the_agents_reply_when_the_turn_finishes() {
    let s = Server::start_live().await;
    let key = s.grant("read", "default").await;
    let token = key["token"].as_str().unwrap();
    let id = key["client"]["id"].as_str().unwrap();
    s.ctx
        .chat
        .chat_manager
        .send_message(&s.chat, "Go", None, None)
        .await
        .unwrap();
    let waiting = blocked_wait(&s, token, id).await;
    let sink = s.live().sink(&s.chat);
    sink.on_message(
        vec![MessageContent::Leaf(LeafContent::Text {
            text: "Done: 3 files changed".into(),
            parent_tool_use_id: None,
        })],
        None,
    );
    sink.on_result(serde_json::from_value(json!({})).unwrap());
    let done = finished(waiting).await;
    assert_eq!(done["chat"]["state"], "idle");
    assert_eq!(done["waitTimedOut"], false);
    assert_eq!(done["lastAssistantText"], "Done: 3 files changed");
    assert_eq!(done["pendingPrompt"], Value::Null);
}

#[tokio::test]
async fn wait_blocks_through_a_turn_and_returns_the_prompt_that_stopped_it() {
    let s = Server::start_live().await;
    let key = s.grant("control", "default").await;
    let (token, id) = (
        key["token"].as_str().unwrap(),
        key["client"]["id"].as_str().unwrap(),
    );
    let sent = s
        .call(token, "chat_send", json!({"chatId":s.chat,"text":"Go"}))
        .await;
    assert_eq!(sent["result"]["structuredContent"]["sent"], true);

    let busy = s
        .call(
            token,
            "chat_wait",
            json!({"chatId":s.chat,"timeoutMs":1000}),
        )
        .await;
    let busy = &busy["result"]["structuredContent"];
    assert_eq!(busy["chat"]["state"], "working");
    assert_eq!(busy["waitTimedOut"], true);
    assert_eq!(busy["stillWaiting"], false);
    assert_eq!(busy["pendingPrompt"], Value::Null);

    let waiting = blocked_wait(&s, token, id).await;
    s.live()
        .sink(&s.chat)
        .on_permission(request("req_1", "Bash", json!({"command":"cargo test"})));
    let done = finished(waiting).await;
    assert_eq!(done["chat"]["state"], "waiting_for_permission");
    assert_eq!(done["stillWaiting"], false);
    assert_eq!(done["waitTimedOut"], false);
    let prompt = &done["pendingPrompt"];
    assert_eq!(prompt["requestId"], "req_1");
    assert_eq!(prompt["kind"], "permission");
    assert_eq!(prompt["toolName"], "Bash");
    assert_eq!(prompt["summary"], r#"{"command":"cargo test"}"#);
    assert_eq!(prompt["canAllow"], true);
    assert_eq!(prompt["answerable"], false);
}
