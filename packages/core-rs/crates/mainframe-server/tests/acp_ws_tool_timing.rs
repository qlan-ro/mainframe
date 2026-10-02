#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use mainframe_types::chat::MessageContent;
use serde_json::{Value, json};
use support::WsClient;
use support::facade::{FacadeServer, spawn_facade_server_with};
use support::tool_timing_adapter::ToolTimingAdapter;

async fn read_until(ws: &mut WsClient, wanted: impl Fn(&Value) -> bool) -> Value {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event = ws.read_event().await;
            if wanted(&event) {
                return event;
            }
        }
    })
    .await
    .expect("expected ACP frame")
}

async fn connect(facade: &FacadeServer) -> WsClient {
    let mut ws = WsClient::connect(
        facade.server.addr,
        &format!("/acp/{}", facade.profile),
        None,
    )
    .await
    .unwrap();
    ws.send_json(&json!({"jsonrpc":"2.0","id":0,"method":"initialize",
        "params":{"protocolVersion":2,"info":{"name":"timing-test","version":"1"}}}))
        .await;
    assert!(
        read_until(&mut ws, |v| v["id"] == 0)
            .await
            .get("result")
            .is_some()
    );
    ws
}

async fn setup() -> (FacadeServer, Arc<ToolTimingAdapter>, WsClient) {
    let adapter = Arc::new(ToolTimingAdapter::default());
    let facade = spawn_facade_server_with(adapter.clone(), 50).await;
    let mut ws = connect(&facade).await;
    ws.send_json(&json!({"jsonrpc":"2.0","id":1,"method":"session/prompt",
        "params":{"sessionId":facade.chat_id,"prompt":[{"type":"text","text":"run tools"}]}}))
        .await;
    let reply = read_until(&mut ws, |v| v["id"] == 1).await;
    assert!(reply.get("result").is_some(), "prompt failed: {reply}");
    (facade, adapter, ws)
}

fn tool(id: &str, name: &str, parent: Option<&str>) -> MessageContent {
    serde_json::from_value(json!({"type":"tool_use","id":id,"name":name,
        "input":{"description":"Inspect"},"parentToolUseId":parent}))
    .unwrap()
}

fn result(id: &str, error: bool, parent: Option<&str>) -> MessageContent {
    serde_json::from_value(json!({"type":"tool_result","toolUseId":id,
        "content":"","isError":error,"parentToolUseId":parent}))
    .unwrap()
}

async fn calls(ws: &mut WsClient, count: usize) -> BTreeMap<String, Value> {
    let mut items = BTreeMap::new();
    while items.len() < count {
        let frame = read_until(ws, |v| {
            v["params"]["update"]["sessionUpdate"] == "tool_call_update"
        })
        .await;
        let update = frame["params"]["update"].clone();
        items.insert(update["toolCallId"].as_str().unwrap().to_owned(), update);
    }
    items
}

fn timing(item: &Value) -> Value {
    item["_meta"]["_mainframe.dev"]["toolCallTiming"].clone()
}

async fn reconnect(
    facade: &FacadeServer,
    mut old: WsClient,
) -> (WsClient, BTreeMap<String, Value>) {
    old.send_json(
        &json!({"jsonrpc":"2.0","method":"_mainframe.dev/session_detach",
        "params":{"sessionId":facade.chat_id}}),
    )
    .await;
    drop(old);
    let mut ws = connect(facade).await;
    ws.send_json(&json!({"jsonrpc":"2.0","id":2,"method":"session/resume",
        "params":{"sessionId":facade.chat_id,"cwd":"/tmp"}}))
        .await;
    let items = calls(&mut ws, 3).await;
    (ws, items)
}

fn assert_snapshot(actual: &BTreeMap<String, Value>, expected: &BTreeMap<String, Value>) {
    assert_eq!(
        actual.keys().collect::<Vec<_>>(),
        expected.keys().collect::<Vec<_>>()
    );
    for (id, item) in expected {
        assert_eq!(timing(&actual[id]), timing(item), "timing for {id}");
        assert_eq!(actual[id]["status"], item["status"], "status for {id}");
        assert_eq!(actual[id]["content"], item["content"], "content for {id}");
        assert_eq!(
            actual[id]["_meta"]["_mainframe.dev"]["parentToolCallId"],
            item["_meta"]["_mainframe.dev"]["parentToolCallId"]
        );
    }
}

async fn complete(
    ws: &mut WsClient,
    adapter: &ToolTimingAdapter,
    items: &mut BTreeMap<String, Value>,
) {
    adapter
        .sink()
        .on_tool_result(vec![result("a", false, None)], None);
    let frame = read_until(ws, |v| {
        v["params"]["update"]["toolCallId"] == "a" && v["params"]["update"]["status"] == "completed"
    })
    .await;
    let patch = &frame["params"]["update"];
    assert_eq!(timing(patch)["startedAt"], timing(&items["a"])["startedAt"]);
    assert!(
        timing(patch)["completedAt"].as_u64().unwrap()
            >= timing(patch)["startedAt"].as_u64().unwrap()
    );
    assert_eq!(
        patch["content"],
        json!([{"type":"content","content":{"type":"text","text":""}}])
    );
    for (key, value) in patch.as_object().unwrap() {
        items.get_mut("a").unwrap()[key] = value.clone();
    }
}

#[tokio::test]
async fn tool_timing_reconnect_retains_overlapping_and_nested_calls() {
    let (facade, adapter, mut ws) = setup().await;
    adapter.sink().on_message(
        vec![tool("a", "Bash", None), tool("parent", "Task", None)],
        None,
    );
    let mut started = calls(&mut ws, 2).await;
    adapter
        .sink()
        .on_subagent_child("parent", vec![tool("child", "Read", Some("parent"))]);
    started.extend(calls(&mut ws, 1).await);
    assert_eq!(started.len(), 3);
    for item in started.values() {
        assert!(timing(item)["startedAt"].as_u64().unwrap() > 0);
        assert!(timing(item).get("completedAt").is_none());
    }
    assert_eq!(
        started["child"]["_meta"]["_mainframe.dev"]["parentToolCallId"],
        "parent"
    );
    let (mut resumed, snapshot) = reconnect(&facade, ws).await;
    assert_snapshot(&snapshot, &started);
    complete(&mut resumed, &adapter, &mut started).await;
    let (mut completed_ws, snapshot) = reconnect(&facade, resumed).await;
    assert_snapshot(&snapshot, &started);
    adapter
        .sink()
        .on_subagent_child("parent", vec![result("child", true, Some("parent"))]);
    let failed = read_until(&mut completed_ws, |v| {
        v["params"]["update"]["toolCallId"] == "child"
            && v["params"]["update"]["status"] == "failed"
    })
    .await;
    let patch = &failed["params"]["update"];
    assert_eq!(
        timing(patch)["startedAt"],
        timing(&started["child"])["startedAt"]
    );
    assert!(timing(patch)["completedAt"].is_u64());
    for (key, value) in patch.as_object().unwrap() {
        started.get_mut("child").unwrap()[key] = value.clone();
    }
    let (_final_ws, snapshot) = reconnect(&facade, completed_ws).await;
    assert_snapshot(&snapshot, &started);
    assert!(timing(&snapshot["parent"]).get("completedAt").is_none());
}
