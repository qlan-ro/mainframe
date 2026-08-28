use std::collections::HashMap;

use mainframe_types::acp::jsonrpc::RequestId;
use mainframe_types::acp::update::SessionUpdate;
use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayMessageType};
use serde_json::json;

use super::*;

fn dmsg(id: &str, content: Vec<DisplayContent>) -> DisplayMessage {
    DisplayMessage {
        id: id.to_string(),
        chat_id: "chat_1".to_string(),
        r#type: DisplayMessageType::Assistant,
        content,
        timestamp: "2026-08-28T00:00:00.000Z".to_string(),
        metadata: None,
    }
}

fn text(s: &str) -> DisplayContent {
    DisplayContent::Leaf(mainframe_types::content::LeafContent::Text {
        text: s.to_string(),
        parent_tool_use_id: None,
    })
}

fn control_request(request_id: &str) -> ControlRequest {
    ControlRequest {
        request_id: request_id.to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "toolu_01A".to_string(),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
    }
}

struct FakePort {
    messages: Vec<DisplayMessage>,
    pending: Option<ControlRequest>,
}

impl ResumePort for FakePort {
    fn resume_snapshot<'a>(
        &'a self,
        _session_id: &'a str,
    ) -> BoxFuture<'a, (Vec<DisplayMessage>, Option<ControlRequest>)> {
        Box::pin(async move { (self.messages.clone(), self.pending.clone()) })
    }
}

fn resume_request(replay_from: Option<Value>) -> JsonRpcRequest {
    let mut params = json!({
        "sessionId": "chat_1",
        "cwd": "/tmp",
    });
    if let Some(cursor) = replay_from {
        params["replayFrom"] = cursor;
    }
    JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Some(RequestId::Number(1)),
        method: "session/resume".to_string(),
        params: Some(params),
    }
}

#[tokio::test]
async fn a_start_cursor_replays_every_item_as_a_create() {
    let port = FakePort {
        messages: vec![dmsg("dmsg_1", vec![text("hello")])],
        pending: None,
    };
    let (response, replay) =
        dispatch_resume(resume_request(Some(json!({ "type": "start" }))), &port).await;

    assert!(matches!(
        response.outcome,
        mainframe_types::acp::jsonrpc::JsonRpcOutcome::Result { .. }
    ));
    assert_eq!(replay.updates.len(), 1);
    assert!(matches!(
        replay.updates[0],
        SessionUpdate::AgentMessage(ref upsert) if upsert.message_id == "dmsg_1"
    ));
}

#[tokio::test]
async fn an_absent_cursor_behaves_like_start() {
    let port = FakePort {
        messages: vec![dmsg("dmsg_1", vec![text("hello")])],
        pending: None,
    };
    let (_response, replay) = dispatch_resume(resume_request(None), &port).await;
    assert_eq!(replay.updates.len(), 1);
}

#[tokio::test]
async fn a_known_cursor_replays_only_items_after_it() {
    let port = FakePort {
        messages: vec![
            dmsg("dmsg_1", vec![text("first")]),
            dmsg("dmsg_2", vec![text("second")]),
        ],
        pending: None,
    };
    let (_response, replay) = dispatch_resume(
        resume_request(Some(json!({ "type": "item", "itemId": "dmsg_1" }))),
        &port,
    )
    .await;

    assert_eq!(replay.updates.len(), 1);
    assert!(matches!(
        replay.updates[0],
        SessionUpdate::AgentMessage(ref upsert) if upsert.message_id == "dmsg_2"
    ));
}

#[tokio::test]
async fn an_unknown_cursor_gets_a_full_replay_with_the_compaction_marker() {
    let port = FakePort {
        messages: vec![dmsg("dmsg_1", vec![text("hello")])],
        pending: None,
    };
    let (response, replay) = dispatch_resume(
        resume_request(Some(json!({ "type": "item", "itemId": "never-seen" }))),
        &port,
    )
    .await;

    assert_eq!(
        replay.updates.len(),
        1,
        "unknown cursor still replays everything"
    );
    let mainframe_types::acp::jsonrpc::JsonRpcOutcome::Result { result } = response.outcome else {
        panic!("expected a success response");
    };
    assert_eq!(result["_meta"]["_mainframe.dev"]["fullReplay"], json!(true));
}

#[tokio::test]
async fn a_malformed_cursor_shape_is_treated_as_unknown_not_a_request_error() {
    let port = FakePort {
        messages: vec![dmsg("dmsg_1", vec![text("hello")])],
        pending: None,
    };
    let (response, replay) = dispatch_resume(
        resume_request(Some(json!({ "type": "not-a-real-cursor-type" }))),
        &port,
    )
    .await;

    assert!(matches!(
        response.outcome,
        mainframe_types::acp::jsonrpc::JsonRpcOutcome::Result { .. }
    ));
    assert_eq!(replay.updates.len(), 1, "still replays, just as a full one");
}

#[tokio::test]
async fn an_open_gate_is_redelivered_as_a_request_permission_request() {
    let port = FakePort {
        messages: Vec::new(),
        pending: Some(control_request("req_1")),
    };
    let (_response, replay) = dispatch_resume(resume_request(None), &port).await;

    let request = replay
        .pending_permission_request
        .expect("open gate must be redelivered");
    assert_eq!(request.method, "session/request_permission");
    let params = request.params.unwrap();
    assert_eq!(params["sessionId"], json!("chat_1"));
}

#[tokio::test]
async fn no_pending_gate_means_no_redelivered_request() {
    let port = FakePort {
        messages: Vec::new(),
        pending: None,
    };
    let (_response, replay) = dispatch_resume(resume_request(None), &port).await;
    assert!(replay.pending_permission_request.is_none());
}

#[tokio::test]
async fn missing_params_gets_invalid_params() {
    let request = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Some(RequestId::Number(1)),
        method: "session/resume".to_string(),
        params: None,
    };
    let port = FakePort {
        messages: Vec::new(),
        pending: None,
    };
    let (response, replay) = dispatch_resume(request, &port).await;
    assert!(matches!(
        response.outcome,
        mainframe_types::acp::jsonrpc::JsonRpcOutcome::Error { .. }
    ));
    assert!(replay.updates.is_empty());
}
