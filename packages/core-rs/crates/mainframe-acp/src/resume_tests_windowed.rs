use super::*;
use mainframe_types::acp::extensions::HistoryPageParams;
use mainframe_types::acp::jsonrpc::JsonRpcOutcome;

fn fixture(count: usize) -> FakePort {
    FakePort {
        messages: (0..count)
            .map(|i| {
                let mut msg = dmsg(&format!("m{i}"), vec![text(&format!("message {i}"))]);
                if i % 10 == 0 {
                    msg.r#type = DisplayMessageType::User;
                }
                msg
            })
            .collect(),
        ..Default::default()
    }
}

fn meta(response: JsonRpcResponse) -> Value {
    match response.outcome {
        JsonRpcOutcome::Result { result } => result["_meta"][MAINFRAME_META_NAMESPACE].clone(),
        other => panic!("unexpected response: {other:?}"),
    }
}

async fn window(
    port: &FakePort,
    cursor: Value,
    options: Value,
    log: &Mutex<RevisionLog>,
) -> (JsonRpcResponse, ResumeReplay) {
    let mut request = resume_request(Some(cursor));
    request.params.as_mut().unwrap()["_meta"] =
        json!({ MAINFRAME_META_NAMESPACE: { "window": options } });
    let boundary = log.lock().unwrap().boundary();
    dispatch_resume_with(
        request,
        port,
        Some((log, boundary)),
        ResumeOptions {
            windowed_history: true,
            result_previews: true,
        },
    )
    .await
}

#[tokio::test]
async fn newest_window_snaps_and_counts_only_replayed_items() {
    let port = fixture(123);
    let log = Mutex::new(RevisionLog::new("epoch".into()));
    let (reply, replay) = window(&port, json!({"type":"start"}), json!({}), &log).await;
    assert_eq!(replay.items.len(), 43);
    assert_eq!(replay.items[0].id(), "m80");
    assert_eq!(replay.containers.len(), 123);
    assert!(replay.containers[..80].iter().all(Vec::is_empty));
    assert_eq!(
        meta(reply)["history"],
        json!({"hasMore":true,"floorItemId":"m80"})
    );
    let (reply, _) = window(
        &port,
        json!({"type":"start"}),
        json!({"containers":1}),
        &log,
    )
    .await;
    assert_eq!(meta(reply)["itemCount"], 3);
}

#[tokio::test]
async fn empty_short_and_clamped_windows() {
    for (count, expected) in [(0, 0), (12, 12), (120, 120)] {
        let log = Mutex::new(RevisionLog::new("epoch".into()));
        let (reply, replay) = window(
            &fixture(count),
            json!({"type":"start"}),
            json!({"containers":999}),
            &log,
        )
        .await;
        let meta = meta(reply);
        assert_eq!(replay.items.len(), expected);
        assert_eq!(meta["history"]["hasMore"], false);
        assert_eq!(meta["itemCount"], expected);
    }
}

#[tokio::test]
async fn revision_resume_filters_changes_before_floor_and_falls_back_on_unknown_floor() {
    let mut port = fixture(120);
    let log = Mutex::new(RevisionLog::new("epoch".into()));
    let (reply, _) = window(&port, json!({"type":"start"}), json!({}), &log).await;
    let cursor = meta(reply)["cursor"].clone();
    port.messages[2].content = vec![text("old change")];
    port.messages[99].content = vec![text("held change")];
    log.lock().unwrap().record_delta(
        &crate::EncodedDelta::full(encoder::encode_containers(&port.messages, None)),
        Vec::new,
    );
    let cursor = json!({"type":"revision", "epoch":cursor["epoch"], "revision":cursor["revision"]});
    let (reply, replay) = window(&port, cursor.clone(), json!({"floorItemId":"m80"}), &log).await;
    assert_eq!(meta(reply)["itemCount"], 1);
    assert_eq!(replay.updates.len(), 2);
    assert!(
        matches!(&replay.updates[0], SessionUpdate::AgentMessage(upsert) if upsert.message_id == "m99")
    );
    let (reply, replay) = window(&port, cursor, json!({"floorItemId":"missing"}), &log).await;
    assert_eq!(meta(reply)["fullReplay"], true);
    assert_eq!(replay.items.len(), 40);
}

#[test]
fn pages_are_contiguous_load_through_is_unbounded_and_unknown_targets_are_stale() {
    let port = fixture(500);
    let params = HistoryPageParams {
        session_id: "chat_1".into(),
        before: "m460".into(),
        containers: Some(1),
        until_item_id: Some("m128".into()),
    };
    let page = crate::history_page::prepare(
        &port.messages,
        &params,
        crate::history_page::PageOptions {
            previews: true,
            ..Default::default()
        },
    );
    assert_eq!(page.start, 120);
    assert_eq!(page.containers.len(), 340);
    assert_eq!(page.result.updates.unwrap().len(), 340);
    let mut params = params;
    params.until_item_id = Some("missing".into());
    assert_eq!(
        crate::history_page::prepare(
            &port.messages,
            &params,
            crate::history_page::PageOptions {
                previews: true,
                ..Default::default()
            }
        )
        .result
        .stale,
        Some(true)
    );
    params.until_item_id = Some("m490".into());
    let page = crate::history_page::prepare(&port.messages, &params, Default::default());
    assert!(page.containers.is_empty());
    assert_eq!(page.result.stale, None);
    assert_eq!(page.result.history.floor_item_id.as_deref(), Some("m460"));
}

#[test]
fn search_counts_overlapping_hits_and_caps_at_the_newest_matches() {
    let mut port = fixture(3);
    port.messages[0].content = vec![text("aaa")];
    port.messages[1].content = vec![thinking("aaa")];
    port.messages[2].r#type = DisplayMessageType::System;
    port.messages[2].content = vec![text("aaa")];
    let result = crate::history_search::search(&port.messages, "AA");
    assert_eq!(result.total, 2);
    assert_eq!(result.matches[1].occurrence, 1);
    port.messages[0].content = vec![text(&"a".repeat(2100))];
    let result = crate::history_search::search(&port.messages, "a");
    assert_eq!(result.total, 2100);
    assert_eq!(result.matches.len(), 2000);
    assert_eq!(result.matches[0].occurrence, 100);
    assert_eq!(result.truncated, Some(true));
    assert_eq!(crate::history_search::search(&port.messages, "").total, 0);
}

#[test]
fn search_strips_capture_and_reference_blocks() {
    let mut port = fixture(1);
    port.messages[0].content = vec![text(
        "Referenced session @session[hidden]: /hidden\n\n\0__MF_SANDBOX_CAPTURE__\n> **Preview captures**\n> - `hidden`\n\nvisible",
    )];
    assert_eq!(
        crate::history_search::search(&port.messages, "hidden").total,
        0
    );
    assert_eq!(
        crate::history_search::search(&port.messages, "visible").total,
        1
    );
}

#[tokio::test]
async fn reconnect_after_container_positions_shift_returns_to_the_newest_window() {
    let mut port = fixture(120);
    let log = Mutex::new(RevisionLog::new("epoch".into()));
    let (reply, _) = window(&port, json!({"type":"start"}), json!({}), &log).await;
    let cursor = meta(reply)["cursor"].clone();
    port.messages.remove(81);
    for i in 0..5 {
        port.messages
            .insert(0, dmsg(&format!("inserted{i}"), vec![text("new")]));
    }
    log.lock().unwrap().record_delta(
        &crate::EncodedDelta::full(encoder::encode_containers(&port.messages, None)),
        Vec::new,
    );
    let (reply, _) = window(
        &port,
        json!({"type":"revision","epoch":cursor["epoch"],"revision":cursor["revision"]}),
        json!({"floorItemId":"m80"}),
        &log,
    )
    .await;
    assert_eq!(meta(reply)["fullReplay"], true);
}

#[tokio::test]
async fn tool_floor_lookup_encodes_only_the_held_window() {
    let mut port = fixture(120);
    port.messages[80].r#type = DisplayMessageType::Assistant;
    port.messages[80].content = vec![thinking("thought first"), text("body")];
    let log = Mutex::new(RevisionLog::new("epoch".into()));
    let (reply, _) = window(&port, json!({"type":"start"}), json!({}), &log).await;
    let cursor = meta(reply)["cursor"].clone();
    encoder::ENCODED_CONTAINERS.with(|count| count.set(0));
    let (reply, _) = window(
        &port,
        json!({"type":"revision","epoch":cursor["epoch"],"revision":cursor["revision"]}),
        json!({"floorItemId":"m80-thought"}),
        &log,
    )
    .await;
    assert_eq!(meta(reply)["history"]["floorItemId"], "m80-thought");
    encoder::ENCODED_CONTAINERS.with(|count| assert_eq!(count.get(), 40));
}

#[tokio::test]
async fn reconnect_keeps_changed_older_results_previewed() {
    let mut port = fixture(120);
    port.messages[90].content = vec![
        serde_json::from_value(json!({
            "type":"tool_call","id":"tool-result","name":"Read","input":{},"category":"default",
            "result":{"content":"a".repeat(32768),"isError":false}
        }))
        .unwrap(),
    ];
    let log = Mutex::new(RevisionLog::new("epoch".into()));
    let (reply, _) = window(&port, json!({"type":"start"}), json!({}), &log).await;
    let cursor = meta(reply)["cursor"].clone();
    port.messages[90].content = vec![
        serde_json::from_value(json!({
            "type":"tool_call","id":"tool-result","name":"Read","input":{},"category":"default",
            "result":{"content":"b".repeat(65536),"isError":false}
        }))
        .unwrap(),
    ];
    log.lock().unwrap().record_delta(
        &crate::EncodedDelta::full(encoder::encode_containers(&port.messages, None)),
        Vec::new,
    );
    let (_, replay) = window(
        &port,
        json!({"type":"revision","epoch":cursor["epoch"],"revision":cursor["revision"]}),
        json!({"floorItemId":"m80"}),
        &log,
    )
    .await;
    let wire = serde_json::to_string(&replay.updates).unwrap();
    assert!(wire.len() < 4096);
    assert!(wire.contains("65536"));
    assert!(replay.preview_ids.contains("tool-result"));
}
