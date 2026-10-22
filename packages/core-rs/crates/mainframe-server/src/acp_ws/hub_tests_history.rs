use super::*;
use mainframe_types::acp::extensions::HistoryPageParams;
use mainframe_types::acp::jsonrpc::RequestId;

fn history() -> Vec<DisplayMessage> {
    (0..120)
        .map(|i| display_message(&format!("m{i}"), "text"))
        .collect()
}

fn params() -> HistoryPageParams {
    HistoryPageParams {
        session_id: "chat-1".into(),
        before: "m80".into(),
        containers: Some(40),
        items: None,
        until_item_id: None,
    }
}

fn receive(rx: &mut mpsc::UnboundedReceiver<String>) -> Vec<Value> {
    std::iter::from_fn(|| rx.try_recv().ok())
        .map(|raw| serde_json::from_str(&raw).unwrap())
        .collect()
}

#[test]
fn a_page_reply_precedes_racing_deltas_and_connections_keep_independent_floors() {
    let hub = hub();
    let (_, conn, mut rx) = hub.register("claude".into());
    conn.mark_windowed_history_opted_in();
    let (_, other, mut other_rx) = hub.register("claude".into());
    other.mark_windowed_history_opted_in();
    let mut messages = history();
    let mut containers = mainframe_acp::encoder::encode_containers(&messages, None);
    for container in &mut containers[..80] {
        container.clear();
    }
    for conn in [&conn, &other] {
        hub.begin_resume(conn, "chat-1");
        hub.reset_session(conn, "chat-1", seed(&containers, &reply(1)), |_| {});
    }
    receive(&mut rx);
    receive(&mut other_rx);
    let stream = hub.begin_history_page(&conn, "chat-1", "m80").unwrap();
    let page = mainframe_acp::history_page::prepare(&messages, &params(), Default::default());
    messages[60].content = vec![DisplayContent::Leaf(LeafContent::Text {
        text: "text more".into(),
        parent_tool_use_id: None,
    })];
    hub.on_chat_surface_event(ChatSurfaceEvent::DisplayRevision {
        chat_id: "chat-1".into(),
        delta: full_delta(messages.clone()),
        streaming: None,
    });
    assert!(receive(&mut rx).is_empty());
    assert!(receive(&mut other_rx).is_empty());
    hub.finish_history_page(&conn, "chat-1", Some(RequestId::Number(2)), stream, page);
    let frames = receive(&mut rx);
    assert_eq!(frames[0]["id"], 2);
    assert_eq!(frames[0]["result"]["floorItemId"], "m40");
    assert_eq!(frames[1]["method"], "session/update");
    assert_eq!(frames[1]["params"]["update"]["messageId"], "m60");
    assert!(hub.begin_history_page(&other, "chat-1", "m40").is_none());
    assert!(hub.begin_history_page(&other, "chat-1", "m80").is_some());
}

#[test]
fn a_detached_session_is_not_resurrected_by_a_page() {
    let hub = hub();
    let (_, conn, mut rx) = hub.register("claude".into());
    conn.mark_windowed_history_opted_in();
    let messages = history();
    let mut containers = mainframe_acp::encoder::encode_containers(&messages, None);
    for container in &mut containers[..80] {
        container.clear();
    }
    hub.begin_resume(&conn, "chat-1");
    hub.reset_session(&conn, "chat-1", seed(&containers, &reply(1)), |_| {});
    receive(&mut rx);
    let stream = hub.begin_history_page(&conn, "chat-1", "m80").unwrap();
    let page = mainframe_acp::history_page::prepare(&messages, &params(), Default::default());
    conn.forget_chat("chat-1");
    hub.finish_history_page(&conn, "chat-1", Some(RequestId::Number(2)), stream, page);
    let frames = receive(&mut rx);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0]["result"]["stale"], true);
    assert!(!conn.is_attached("chat-1"));
}
