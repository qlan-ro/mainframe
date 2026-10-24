use super::*;
use crate::resume::persisted::PreparedHistoryTail;
use mainframe_types::acp::jsonrpc::JsonRpcOutcome;

async fn prepared(port: &FakePort, containers: usize) -> (JsonRpcResponse, ResumeReplay) {
    let mut request = resume_request(Some(json!({"type":"start"})));
    request.params.as_mut().unwrap()["_meta"] =
        json!({ MAINFRAME_META_NAMESPACE: {"window":{"containers":containers}} });
    dispatch_resume_with(
        request,
        port,
        None,
        ResumeOptions {
            result_previews: true,
            windowed_history: true,
        },
    )
    .await
}

#[tokio::test]
async fn persisted_replay_keeps_window_items_and_replaces_request_and_epoch() {
    let port = FakePort {
        messages: (0..6)
            .map(|i| {
                let mut msg = dmsg(&format!("m{i}"), vec![text(&format!("body {i}"))]);
                msg.r#type = DisplayMessageType::User;
                msg
            })
            .collect(),
        ..Default::default()
    };
    let (reply, replay) = prepared(&port, 2).await;
    let saved = PreparedHistoryTail::capture(&reply, &replay).unwrap();
    let saved: PreparedHistoryTail =
        serde_json::from_slice(&serde_json::to_vec(&saved).unwrap()).unwrap();
    let cursor = WireRevisionCursor {
        epoch: "fresh".into(),
        revision: 7,
    };
    let (reply, restored) = saved.replay(Some(RequestId::Number(99)), Some(&cursor));
    assert_eq!(reply.id, Some(RequestId::Number(99)));
    let JsonRpcOutcome::Result { result } = reply.outcome else {
        panic!("missing result")
    };
    let meta = &result["_meta"][MAINFRAME_META_NAMESPACE];
    assert_eq!(meta["cursor"], json!({"epoch":"fresh","revision":7}));
    assert_eq!(meta["history"], json!({"hasMore":true,"floorItemId":"m4"}));
    assert_eq!(
        serde_json::to_value(&restored.updates).unwrap(),
        serde_json::to_value(&replay.updates).unwrap()
    );
    assert_eq!(restored.containers.len(), 6);
    assert!(restored.containers[..4].iter().all(Vec::is_empty));
}

#[tokio::test]
async fn pending_permissions_are_never_persisted() {
    let port = FakePort {
        messages: vec![dmsg("m1", vec![text("hello")])],
        pending: Some(control_request("req")),
        ..Default::default()
    };
    let (reply, replay) = prepared(&port, 2).await;
    assert!(PreparedHistoryTail::capture(&reply, &replay).is_none());
}

#[tokio::test]
async fn persisted_previews_do_not_retain_full_tool_output() {
    let tool = serde_json::from_value(json!({
        "type":"tool_call","id":"tool-result","name":"Read","input":{},"category":"default",
        "result":{"content":"x".repeat(65536),"isError":false}
    }))
    .unwrap();
    let mut next = dmsg("new", vec![text("done")]);
    next.r#type = DisplayMessageType::User;
    let port = FakePort {
        messages: std::iter::once(dmsg("old", vec![tool]))
            .chain((0..24).map(|i| {
                let mut msg = next.clone();
                msg.id = format!("new{i}");
                msg
            }))
            .collect(),
        ..Default::default()
    };
    let (reply, replay) = prepared(&port, 40).await;
    let saved = PreparedHistoryTail::capture(&reply, &replay).unwrap();
    let bytes = serde_json::to_vec(&saved).unwrap();
    assert!(replay.preview_ids.contains("tool-result"));
    assert!(bytes.len() < 32768);
    let (_, restored) = saved.replay(None, None);
    assert_eq!(
        serde_json::to_value(restored.updates).unwrap(),
        serde_json::to_value(replay.updates).unwrap()
    );
}
