use super::*;
use std::collections::HashSet;

fn large(nested: bool) -> FakePort {
    let calls: Vec<Value> = (0..407)
        .map(|i| {
            json!({
                "type":"tool_call", "id":format!("tool-{i}"), "name":"Read", "input":{},
                "category":"default", "result":{"content":format!("result {i}"), "isError":false}
            })
        })
        .collect();
    let content = if nested {
        vec![json!({"type":"task_group", "agentId":"task", "taskArgs":{}, "calls":calls})]
    } else {
        calls
    };
    FakePort {
        messages: vec![dmsg("big", serde_json::from_value(json!(content)).unwrap())],
        ..Default::default()
    }
}

#[tokio::test]
async fn a_single_large_container_has_an_item_floor_and_pages_without_gaps() {
    for nested in [false, true] {
        let port = large(nested);
        let log = Mutex::new(RevisionLog::new("epoch".into()));
        let (reply, replay) =
            window(&port, json!({"type":"start"}), json!({"items":80}), &log).await;
        let mut history = meta(reply)["history"].clone();
        assert_eq!(
            history,
            json!({"hasMore":true,"floorItemId":"tool-327","contextItemIds":if nested { vec!["task"] } else { vec![] }})
        );
        assert_eq!(replay.items.len(), 80 + usize::from(nested));
        if nested {
            assert_eq!(replay.items[0].id(), "task");
        }
        let mut ids: HashSet<String> = replay.items.iter().map(|item| item.id().into()).collect();
        let mut requests = 0;
        while history["hasMore"] == true {
            let params = HistoryPageParams {
                session_id: "chat_1".into(),
                before: history["floorItemId"].as_str().unwrap().into(),
                containers: Some(40),
                items: Some(80),
                until_item_id: None,
            };
            let page = crate::history_page::prepare(&port.messages, &params, Default::default());
            assert_ne!(page.result.stale, Some(true));
            let items: Vec<_> = page.containers.iter().flatten().collect();
            assert!(items.len() <= 80 + usize::from(nested));
            assert!(!items.is_empty());
            ids.extend(items.iter().map(|item| item.id().to_owned()));
            history = serde_json::to_value(page.result.history).unwrap();
            requests += 1;
            assert!(requests < 10);
        }
        assert_eq!(ids.len(), 407 + usize::from(nested));
    }
}

#[tokio::test]
async fn reconnect_retains_the_partial_container_and_ignores_hidden_changes() {
    let mut port = large(true);
    let log = Mutex::new(RevisionLog::new("epoch".into()));
    let (reply, _) = window(&port, json!({"type":"start"}), json!({"items":80}), &log).await;
    let cursor = meta(reply)["cursor"].clone();
    let mainframe_types::display::DisplayContent::Node(
        mainframe_types::display::DisplayNode::TaskGroup { calls, .. },
    ) = &mut port.messages[0].content[0]
    else {
        panic!()
    };
    for i in [1, 400] {
        let mainframe_types::display::DisplayContent::Node(
            mainframe_types::display::DisplayNode::ToolCall { result, .. },
        ) = &mut calls[i]
        else {
            panic!()
        };
        result.as_mut().unwrap().content = "changed".into();
    }
    log.lock().unwrap().record_delta(
        &crate::EncodedDelta::full(encoder::encode_containers(&port.messages, None)),
        Vec::new,
    );
    let (reply, replay) = window(
        &port,
        json!({"type":"revision","epoch":cursor["epoch"],"revision":cursor["revision"]}),
        json!({"items":80,"floorItemId":"tool-327","contextItemIds":["task"]}),
        &log,
    )
    .await;
    assert_ne!(meta(reply)["fullReplay"], true);
    assert_eq!(replay.items.len(), 81);
    let wire = serde_json::to_value(&replay.updates).unwrap();
    let tools: Vec<_> = wire
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|u| u["toolCallId"].as_str())
        .collect();
    assert_eq!(tools, vec!["tool-400"]);
}

#[test]
fn load_through_reaches_a_target_inside_the_same_container() {
    let port = large(true);
    let params = HistoryPageParams {
        session_id: "chat_1".into(),
        before: "tool-327".into(),
        containers: Some(40),
        items: Some(80),
        until_item_id: Some("tool-10".into()),
    };
    let page = crate::history_page::prepare(&port.messages, &params, Default::default());
    assert_eq!(
        page.result.history.floor_item_id.as_deref(),
        Some("tool-10")
    );
    assert!(
        page.containers
            .iter()
            .flatten()
            .any(|item| item.id() == "tool-10")
    );
    assert!(
        !page
            .containers
            .iter()
            .flatten()
            .any(|item| item.id() == "tool-327")
    );
}

#[tokio::test]
async fn item_limits_clamp_and_reconnect_preserves_more_than_one_loaded_page() {
    let port = large(false);
    let log = Mutex::new(RevisionLog::new("epoch".into()));
    for (limit, count) in [(0, 1), (999, 200)] {
        let (_, replay) =
            window(&port, json!({"type":"start"}), json!({"items":limit}), &log).await;
        assert_eq!(replay.items.len(), count);
    }
    let boundary = log.lock().unwrap().boundary();
    let (reply, replay) = window(
        &port,
        json!({"type":"revision","epoch":boundary.epoch,"revision":boundary.revision}),
        json!({"items":80,"floorItemId":"tool-87"}),
        &log,
    )
    .await;
    assert_ne!(meta(reply)["fullReplay"], true);
    assert_eq!(replay.items.len(), 320);
    assert_eq!(replay.updates.len(), 1);
}

#[test]
fn pages_skip_empty_encoded_containers_and_reach_the_beginning() {
    let mut port = fixture(120);
    for message in &mut port.messages[..119] {
        message.content = vec![];
    }
    let params = HistoryPageParams {
        session_id: "chat_1".into(),
        before: "m119".into(),
        items: Some(80),
        containers: Some(40),
        until_item_id: None,
    };
    let page = crate::history_page::prepare(&port.messages, &params, Default::default());
    assert!(!page.result.history.has_more);
    port.messages[0].content = vec![text("old")];
    let page = crate::history_page::prepare(&port.messages, &params, Default::default());
    assert_eq!(page.result.history.floor_item_id.as_deref(), Some("m0"));
    assert!(!page.result.history.has_more);
}

#[tokio::test]
async fn changed_context_replays_the_loaded_floor_without_dropping_pages() {
    let mut port = large(true);
    let log = Mutex::new(RevisionLog::new("epoch".into()));
    let (reply, _) = window(&port, json!({"type":"start"}), json!({"items":80}), &log).await;
    let cursor = meta(reply)["cursor"].clone();
    let mainframe_types::display::DisplayContent::Node(
        mainframe_types::display::DisplayNode::TaskGroup { calls, .. },
    ) = &mut port.messages[0].content[0]
    else {
        panic!()
    };
    let tail = calls.split_off(300);
    calls.push(
        serde_json::from_value(
            json!({"type":"task_group","agentId":"new-task","taskArgs":{},"calls":tail}),
        )
        .unwrap(),
    );
    log.lock().unwrap().record_delta(
        &crate::EncodedDelta::full(encoder::encode_containers(&port.messages, None)),
        Vec::new,
    );
    let (reply, replay) = window(
        &port,
        json!({"type":"revision","epoch":cursor["epoch"],"revision":cursor["revision"]}),
        json!({"items":80,"floorItemId":"tool-310","contextItemIds":["task"]}),
        &log,
    )
    .await;
    let meta = meta(reply);
    assert_eq!(meta["fullReplay"], true);
    assert_eq!(meta["history"]["floorItemId"], "tool-310");
    assert_eq!(
        meta["history"]["contextItemIds"],
        json!(["task", "new-task"])
    );
    assert_eq!(replay.items.len(), 99);
}

#[tokio::test]
async fn preorder_parallel_tasks_include_the_old_context_when_a_page_reaches_a_sibling() {
    let groups:Vec<_>=["a","b"].iter().map(|parent|json!({"type":"task_group","agentId":parent,"taskArgs":{},
        "calls":(0..200).map(|i|json!({"type":"tool_call","id":format!("{parent}-{i}"),"name":"Read","input":{},"category":"default"})).collect::<Vec<_>>()
    })).collect();
    let port = FakePort {
        messages: vec![dmsg("big", serde_json::from_value(json!(groups)).unwrap())],
        ..Default::default()
    };
    let log = Mutex::new(RevisionLog::new("epoch".into()));
    let (reply, _) = window(&port, json!({"type":"start"}), json!({"items":80}), &log).await;
    assert_eq!(meta(reply)["history"]["contextItemIds"], json!(["b"]));
    let mut params = HistoryPageParams {
        session_id: "chat_1".into(),
        before: "b-120".into(),
        containers: Some(40),
        items: Some(80),
        until_item_id: None,
    };
    let page = crate::history_page::prepare(&port.messages, &params, Default::default());
    assert_eq!(page.result.history.floor_item_id.as_deref(), Some("b-40"));
    assert!(page.containers[0].iter().any(|item| item.id() == "b"));
    params.before = "b-40".into();
    let page = crate::history_page::prepare(&port.messages, &params, Default::default());
    assert!(page.containers[0].iter().any(|item| item.id() == "b"));
    assert_eq!(page.containers[0].first().unwrap().id(), "a");
}
