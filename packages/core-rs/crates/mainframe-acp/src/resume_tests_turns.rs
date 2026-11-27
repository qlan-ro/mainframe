use super::*;
use mainframe_types::acp::extensions::HistoryWindow;

fn kind(port: &mut FakePort, index: usize, kind: DisplayMessageType) {
    port.messages[index].r#type = kind;
}

fn flag(port: &mut FakePort, index: usize, key: &str, value: Value) {
    port.messages[index]
        .metadata
        .get_or_insert_default()
        .insert(key.into(), value);
}

async fn first(port: &FakePort, options: Value) -> (Value, ResumeReplay) {
    let log = Mutex::new(RevisionLog::new("epoch".into()));
    let (reply, replay) = window(port, json!({"type":"start"}), options, &log).await;
    (meta(reply), replay)
}

#[tokio::test]
async fn a_window_of_turns_takes_whole_turns_and_skips_the_item_trim() {
    // Users at 0, 10, ..., 120; each turn is ten containers.
    let port = fixture(123);
    let (meta, replay) = first(&port, json!({"turns":2})).await;
    assert_eq!(replay.items[0].id(), "message:0:top:m110");
    assert_eq!(replay.items.len(), 13);
    assert_eq!(
        meta["history"],
        json!({"hasMore":true,"floorItemId":"message:0:top:m110"})
    );
    // `turns` replaces both counts.
    let (_, with_counts) = first(&port, json!({"turns":2,"containers":1,"items":3})).await;
    assert_eq!(with_counts.items.len(), 13);
    let (meta, replay) = first(&port, json!({"turns":50})).await;
    assert_eq!(replay.items.len(), 123);
    assert_eq!(meta["history"]["hasMore"], false);
}

#[tokio::test]
async fn a_request_without_turns_is_unchanged() {
    let port = fixture(123);
    let (_, plain) = first(&port, json!({})).await;
    let (_, containers) = first(&port, json!({"containers":40})).await;
    assert_eq!(plain.items.len(), 43);
    assert_eq!(
        serde_json::to_value(&plain.updates).unwrap(),
        serde_json::to_value(&containers.updates).unwrap()
    );
    let window = HistoryWindow {
        containers: Some(40),
        items: Some(80),
        ..Default::default()
    };
    assert_eq!(
        serde_json::to_value(window).unwrap(),
        json!({"containers":40,"items":80})
    );
}

#[tokio::test]
async fn hidden_replies_queued_prompts_and_the_running_turn_follow_the_user_turn_rule() {
    let mut port = fixture(8);
    // u0 a1 a2 | u3 a4 hidden(a5) a6 | queued(7)
    for index in 0..8 {
        kind(&mut port, index, DisplayMessageType::Assistant);
    }
    for index in [0, 3] {
        kind(&mut port, index, DisplayMessageType::User);
    }
    flag(&mut port, 5, "turnGroup", json!("g2"));
    flag(
        &mut port,
        5,
        "hiddenPromptEvent",
        json!("Background task finished"),
    );
    // The hidden-prompt reply is inside the turn that began at u3.
    let (_, replay) = first(&port, json!({"turns":1})).await;
    assert_eq!(replay.items[0].id(), "message:0:top:m3");
    let (_, replay) = first(&port, json!({"turns":2})).await;
    assert_eq!(replay.items[0].id(), "message:0:top:m0");
    // A queued prompt rides at the end without counting.
    kind(&mut port, 7, DisplayMessageType::User);
    flag(&mut port, 7, "queued", json!(true));
    let (_, replay) = first(&port, json!({"turns":1})).await;
    assert_eq!(replay.items[0].id(), "message:0:top:m3");
    assert_eq!(replay.items.len(), 4);
}

#[tokio::test]
async fn the_size_guard_drops_whole_turns_and_keeps_one() {
    let blob = "x".repeat(600_000);
    let mut port = fixture(6);
    for index in 0..6 {
        port.messages[index].content = vec![text(&blob)];
        kind(
            &mut port,
            index,
            if index % 2 == 0 {
                DisplayMessageType::User
            } else {
                DisplayMessageType::Assistant
            },
        );
    }
    // Each turn is about 1.2 MB: only the newest survives, whole.
    let (meta, replay) = first(&port, json!({"turns":3})).await;
    assert_eq!(replay.items.len(), 2);
    assert_eq!(replay.items[0].id(), "message:0:top:m4");
    assert_eq!(meta["history"]["hasMore"], true);
    // Ten small turns fit whole.
    let (_, small) = first(&fixture(30), json!({"turns":3})).await;
    assert_eq!(small.items.len(), 10 + 10 + 10);
}

#[test]
fn pages_by_turns_count_back_from_the_floor() {
    let port = fixture(123);
    let params = |before: &str, turns| HistoryPageParams {
        session_id: "chat_1".into(),
        before: before.into(),
        containers: Some(40),
        items: Some(80),
        turns,
        until_item_id: None,
    };
    let page = crate::history_page::prepare(
        &port.messages,
        &params("message:0:top:m110", Some(2)),
        Default::default(),
    );
    assert_eq!(page.start, 90);
    assert_eq!(page.containers.len(), 20);
    assert_eq!(
        page.result.history.floor_item_id.as_deref(),
        Some("message:0:top:m90")
    );
    assert!(page.result.history.has_more);
    let page = crate::history_page::prepare(
        &port.messages,
        &params("message:0:top:m10", Some(5)),
        Default::default(),
    );
    assert_eq!((page.start, page.result.history.has_more), (0, false));
    // Without `turns` the same request still pages by containers and items.
    let page = crate::history_page::prepare(
        &port.messages,
        &params("message:0:top:m110", None),
        Default::default(),
    );
    assert_eq!(page.start, 70);
}

#[test]
fn the_requested_turns_survive_when_the_bytes_sent_are_small() {
    // Five turns, each with a 400 KB screenshot: the desktop client receives each
    // image as a short reference, so four turns fit far under the 1 MB limit.
    let image = "A".repeat(400_000);
    let messages: Vec<DisplayMessage> = (1..=5)
        .flat_map(|n| {
            [
                json!({"id":format!("u{n}"),"chatId":"chat","type":"user","timestamp":"now",
                    "content":[{"type":"text","text":"look"}]}),
                json!({"id":format!("a{n}"),"chatId":"chat","type":"assistant","timestamp":"now","content":[
                    {"type":"tool_call","id":format!("t{n}"),"name":"Read","input":{},"category":"default",
                     "result":{"content":"screenshot","isError":false,
                        "images":[{"mediaType":"image/png","data":image}]}}]}),
            ]
        })
        .map(|value| serde_json::from_value(value).unwrap())
        .collect();
    let params = HistoryPageParams {
        session_id: "chat_1".into(),
        before: "message:0:top:u5".into(),
        containers: None,
        items: None,
        turns: Some(4),
        until_item_id: None,
    };
    let options = crate::history_page::PageOptions {
        previews: true,
        lazy_tool_images: true,
        ..Default::default()
    };
    let page = crate::history_page::prepare(&messages, &params, options);
    assert_eq!(page.start, 0);
    assert_eq!(page.containers.len(), 8);
    let sent = serde_json::to_vec(&page.result.updates).unwrap().len();
    assert!(sent < 20_000, "{sent}");
}
