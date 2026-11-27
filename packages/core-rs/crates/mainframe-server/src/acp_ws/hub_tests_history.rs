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
        before: "message:0:top:m80".into(),
        containers: Some(40),
        items: None,
        turns: None,
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
    let stream = hub
        .begin_history_page(&conn, "chat-1", "message:0:top:m80")
        .unwrap();
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
    assert_eq!(frames[0]["result"]["floorItemId"], "message:0:top:m40");
    assert_eq!(frames[1]["method"], "session/update");
    assert_eq!(
        frames[1]["params"]["update"]["messageId"],
        "message:0:top:m60"
    );
    assert!(
        hub.begin_history_page(&other, "chat-1", "message:0:top:m40")
            .is_none()
    );
    assert!(
        hub.begin_history_page(&other, "chat-1", "message:0:top:m80")
            .is_some()
    );
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
    let stream = hub
        .begin_history_page(&conn, "chat-1", "message:0:top:m80")
        .unwrap();
    let page = mainframe_acp::history_page::prepare(&messages, &params(), Default::default());
    conn.forget_chat("chat-1");
    hub.finish_history_page(&conn, "chat-1", Some(RequestId::Number(2)), stream, page);
    let frames = receive(&mut rx);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0]["result"]["stale"], true);
    assert!(!conn.is_attached("chat-1"));
}

fn inflate(payload: &[u8]) -> Vec<Value> {
    use std::io::Read;
    let mut text = String::new();
    flate2::read::ZlibDecoder::new(payload)
        .read_to_string(&mut text)
        .unwrap();
    serde_json::from_str(&text).unwrap()
}

/// A binary page answers with `batchFrames` and no updates, its frames follow
/// on the binary channel tied to the request id, and the live delta that
/// raced the page still trails the reply on the text channel.
#[test]
fn a_binary_page_sends_frames_tied_to_its_request_id() {
    let hub = hub();
    let (_, conn, mut rx) = hub.register("claude".into());
    conn.mark_windowed_history_opted_in();
    let mut binary = conn.take_binary_frames().unwrap();
    let mut messages = history();
    let mut containers = mainframe_acp::encoder::encode_containers(&messages, None);
    for container in &mut containers[..80] {
        container.clear();
    }
    hub.begin_resume(&conn, "chat-1");
    hub.reset_session(&conn, "chat-1", seed(&containers, &reply(1)), |_| {});
    receive(&mut rx);
    let stream = hub
        .begin_history_page(&conn, "chat-1", "message:0:top:m80")
        .unwrap();
    let options = mainframe_acp::history_page::PageOptions {
        compressed: true,
        binary: true,
        ..Default::default()
    };
    let page = mainframe_acp::history_page::prepare(&messages, &params(), options);
    let expected = page.result.frames.len();
    assert!(expected >= 1);
    messages[60].content = vec![DisplayContent::Leaf(LeafContent::Text {
        text: "text more".into(),
        parent_tool_use_id: None,
    })];
    hub.on_chat_surface_event(ChatSurfaceEvent::DisplayRevision {
        chat_id: "chat-1".into(),
        delta: full_delta(messages.clone()),
        streaming: None,
    });
    hub.finish_history_page(&conn, "chat-1", Some(RequestId::Number(41)), stream, page);

    let frames = receive(&mut rx);
    assert_eq!(frames[0]["id"], 41);
    assert_eq!(frames[0]["result"]["batchFrames"], expected);
    assert!(frames[0]["result"].get("updates").is_none());
    assert!(frames[0]["result"].get("batches").is_none());
    assert!(frames[0]["result"].get("frames").is_none());
    assert_eq!(frames[1]["method"], "session/update");

    let mut updates = 0;
    for index in 0..expected {
        let raw = binary.try_recv().unwrap();
        let frame = mainframe_acp::binary_frame::decode_frame(&raw).unwrap();
        assert_eq!(
            (frame.id, frame.index, frame.total),
            ("41", index, expected)
        );
        let batch = inflate(frame.payload);
        assert_eq!(batch.len(), frame.count);
        updates += batch.len();
    }
    assert_eq!(updates, 40);
    assert!(binary.try_recv().is_err());
}

/// A connection that did not opt in gets today's text form and nothing on the
/// binary channel, whether or not it asked for compressed batches.
#[test]
fn an_old_client_page_stays_text_only() {
    for compressed in [false, true] {
        let hub = hub();
        let (_, conn, mut rx) = hub.register("claude".into());
        conn.mark_windowed_history_opted_in();
        let mut binary = conn.take_binary_frames().unwrap();
        let messages = history();
        let mut containers = mainframe_acp::encoder::encode_containers(&messages, None);
        for container in &mut containers[..80] {
            container.clear();
        }
        hub.begin_resume(&conn, "chat-1");
        hub.reset_session(&conn, "chat-1", seed(&containers, &reply(1)), |_| {});
        receive(&mut rx);
        let stream = hub
            .begin_history_page(&conn, "chat-1", "message:0:top:m80")
            .unwrap();
        let options = mainframe_acp::history_page::PageOptions {
            compressed,
            ..Default::default()
        };
        let page = mainframe_acp::history_page::prepare(&messages, &params(), options);
        hub.finish_history_page(&conn, "chat-1", Some(RequestId::Number(5)), stream, page);
        let result = &receive(&mut rx)[0]["result"];
        assert!(result.get("batchFrames").is_none());
        assert_eq!(result.get("batches").is_some(), compressed);
        assert_eq!(result.get("updates").is_some(), !compressed);
        assert!(binary.try_recv().is_err());
    }
}

/// A frame that cannot be framed (an id longer than the header allows) turns
/// the reply into an error rather than leaving the client waiting.
#[test]
fn an_unframeable_reply_is_an_error_not_a_hang() {
    let hub = hub();
    let (_, conn, mut rx) = hub.register("claude".into());
    let mut binary = conn.take_binary_frames().unwrap();
    let frame = mainframe_types::acp::extensions::BatchFrame {
        count: 1,
        bytes: vec![1],
    };
    conn.send_result_with_frames(
        Some(RequestId::String("x".repeat(70_000))),
        json!({"batchFrames": 1}),
        vec![frame],
    );
    assert_eq!(receive(&mut rx)[0]["error"]["code"], -32603);
    assert!(binary.try_recv().is_err());
}

#[test]
fn a_raised_floor_accepts_the_next_page_before_it_and_refuses_the_old_floor() {
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
    // The floor can only go up, and only to an item the stream holds.
    assert!(
        hub.raise_history_floor(&conn, "chat-1", "message:0:top:nope")
            .is_none()
    );
    assert!(
        hub.raise_history_floor(&conn, "chat-1", "message:0:top:m20")
            .is_none()
    );
    let state = hub
        .raise_history_floor(&conn, "chat-1", "message:0:top:m100")
        .unwrap();
    assert_eq!(state.floor_item_id.as_deref(), Some("message:0:top:m100"));
    assert!(state.has_more);
    assert!(
        hub.begin_history_page(&conn, "chat-1", "message:0:top:m80")
            .is_none()
    );
    assert!(
        hub.begin_history_page(&conn, "chat-1", "message:0:top:m100")
            .is_some()
    );
    // Not live on this connection: nothing to raise.
    let (_, other, _) = hub.register("claude".into());
    assert!(
        hub.raise_history_floor(&other, "chat-1", "message:0:top:m100")
            .is_none()
    );
}
