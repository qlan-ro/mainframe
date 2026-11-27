use crate::encoder;
use crate::history_around::prepare;
use crate::history_page::PageOptions;
use crate::resume::ResumeSnapshot;
use crate::resume::{BoxFuture, MessageReader, ResumePort, with_messages};
use mainframe_types::acp::extensions::{HistoryAroundParams, HistoryAroundResult};
use mainframe_types::display::DisplayMessage;
use serde_json::json;

/// Six turns: a user prompt, then an assistant reply with text and two tool calls.
pub(crate) fn transcript(turns: usize) -> Vec<DisplayMessage> {
    let mut out = Vec::new();
    for turn in 0..turns {
        out.push(
            serde_json::from_value(json!({"id":format!("u{turn}"),"chatId":"c","type":"user",
                "timestamp":"now","content":[{"type":"text","text":format!("question {turn}")}]}))
            .unwrap(),
        );
        out.push(
            serde_json::from_value(
                json!({"id":format!("a{turn}"),"chatId":"c","type":"assistant",
                "timestamp":"now","content":[
                    {"type":"text","text":format!("answer {turn}")},
                    {"type":"tool_call","id":format!("t{turn}a"),"name":"Read","input":{},
                        "category":"default","result":{"content":"ok","isError":false}},
                    {"type":"tool_call","id":format!("t{turn}b"),"name":"Read","input":{},
                        "category":"default","result":{"content":"ok","isError":false}}
                ]}),
            )
            .unwrap(),
        );
    }
    out
}

fn flat_ids(messages: &[DisplayMessage]) -> Vec<String> {
    encoder::encode_containers(messages, None)
        .iter()
        .flatten()
        .map(|item| item.id().to_owned())
        .collect()
}

fn around(
    messages: &[DisplayMessage],
    item: &str,
    before: Option<i64>,
    after: Option<i64>,
) -> HistoryAroundResult {
    let params = HistoryAroundParams {
        session_id: "c".into(),
        item_id: item.into(),
        before,
        after,
        include_descendants: None,
    };
    prepare(messages, &params, PageOptions::default())
}

fn update_item_ids(result: &HistoryAroundResult) -> Vec<String> {
    let mut ids = Vec::new();
    for update in result.updates.as_ref().unwrap() {
        let value = serde_json::to_value(update).unwrap();
        let id = value["messageId"]
            .as_str()
            .or_else(|| value["toolCallId"].as_str())
            .unwrap()
            .to_owned();
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids
}

#[test]
fn a_page_around_the_first_item_has_nothing_before_it() {
    let messages = transcript(6);
    let ids = flat_ids(&messages);
    let result = around(&messages, &ids[0], Some(5), Some(3));
    assert!(!result.has_before);
    assert!(result.has_after);
    assert_eq!(result.first_item_id.as_ref(), Some(&ids[0]));
    assert_eq!(result.target_item_id.as_ref(), Some(&ids[0]));
    assert_eq!(result.last_item_id.as_ref(), Some(&ids[3]));
    assert_eq!(update_item_ids(&result), ids[..4]);
}

#[test]
fn a_page_around_a_middle_item_holds_exact_counts_each_side() {
    let messages = transcript(6);
    let ids = flat_ids(&messages);
    let target = 13;
    let result = around(&messages, &ids[target], Some(5), Some(4));
    assert!(result.has_before && result.has_after);
    assert_eq!(result.first_item_id.as_ref(), Some(&ids[target - 5]));
    assert_eq!(result.last_item_id.as_ref(), Some(&ids[target + 4]));
    assert_eq!(result.target_item_id.as_ref(), Some(&ids[target]));
    assert_eq!(update_item_ids(&result), ids[target - 5..=target + 4]);
}

#[test]
fn a_page_around_the_last_item_has_nothing_after_it() {
    let messages = transcript(6);
    let ids = flat_ids(&messages);
    let last = ids.len() - 1;
    let result = around(&messages, &ids[last], Some(2), Some(50));
    assert!(result.has_before);
    assert!(!result.has_after);
    assert_eq!(result.last_item_id.as_ref(), Some(&ids[last]));
    assert_eq!(update_item_ids(&result), ids[last - 2..]);
}

#[test]
fn an_unknown_item_is_stale_and_carries_no_page() {
    let messages = transcript(3);
    let result = around(&messages, "message:0:top:nope", None, None);
    assert_eq!(result.stale, Some(true));
    assert!(result.updates.is_none() && result.first_item_id.is_none());
    assert_eq!(around(&[], "u0", None, None).stale, Some(true));
}

#[test]
fn a_window_crosses_a_turn_boundary_without_gaps() {
    let messages = transcript(4);
    let ids = flat_ids(&messages);
    // Containers: u0 | a0 (3 items) | u1 | a1 ... so u2 sits at flat index 6.
    let user = ids.iter().position(|id| id.ends_with(":u2")).unwrap();
    let result = around(&messages, &ids[user], Some(2), Some(2));
    assert_eq!(update_item_ids(&result), ids[user - 2..=user + 2]);
    assert!(result.has_before && result.has_after);
}

#[test]
fn a_tool_use_id_and_a_container_id_resolve_to_their_item() {
    let messages = transcript(3);
    let ids = flat_ids(&messages);
    let tool = ids.iter().position(|id| id == "tool:t1b").unwrap();
    let by_tool = around(&messages, "t1b", Some(1), Some(1));
    assert_eq!(by_tool.target_item_id.as_ref(), Some(&ids[tool]));
    let by_container = around(&messages, "a1", Some(0), Some(0));
    let first_of_a1 = ids.iter().position(|id| id.ends_with(":a1")).unwrap();
    assert_eq!(
        by_container.target_item_id.as_ref(),
        Some(&ids[first_of_a1])
    );
    assert_eq!(
        update_item_ids(&by_container),
        ids[first_of_a1..=first_of_a1]
    );
}

#[test]
fn counts_default_clamp_and_may_be_zero() {
    let messages = transcript(300);
    let ids = flat_ids(&messages);
    assert_eq!(ids.len(), 1200);
    let mid = ids.len() / 2;
    let defaults = around(&messages, &ids[mid], None, None);
    assert_eq!(update_item_ids(&defaults).len(), 41);
    let huge = around(&messages, &ids[mid], Some(9_999), Some(9_999));
    assert_eq!(update_item_ids(&huge).len(), 401);
    assert_eq!(update_item_ids(&huge), ids[mid - 200..=mid + 200]);
    let only = around(&messages, &ids[mid], Some(-4), Some(0));
    assert_eq!(update_item_ids(&only), ids[mid..=mid]);
}

#[test]
fn a_cut_inside_a_sub_agent_group_brings_its_ancestor_as_context() {
    let calls: Vec<_> = (0..8)
        .map(|i| {
            json!({"type":"tool_call","id":format!("c{i}"),"name":"Read","input":{},
            "category":"default","result":{"content":"ok","isError":false}})
        })
        .collect();
    let messages: Vec<DisplayMessage> = vec![
        serde_json::from_value(
            json!({"id":"big","chatId":"c","type":"assistant","timestamp":"now",
            "content":[{"type":"task_group","agentId":"task","taskArgs":{},"calls":calls}]}),
        )
        .unwrap(),
    ];
    let ids = flat_ids(&messages);
    let target = ids.iter().position(|id| id == "tool:c4").unwrap();
    let result = around(&messages, "c4", Some(1), Some(1));
    assert_eq!(
        result.first_item_id.as_deref(),
        Some(ids[target - 1].as_str())
    );
    assert_eq!(result.context_item_ids, Some(vec!["tool:task".to_owned()]));
    assert!(update_item_ids(&result).contains(&"tool:task".to_owned()));
    assert!(result.has_before && result.has_after);
}

#[test]
fn compressed_connections_get_batches() {
    let messages = transcript(3);
    let ids = flat_ids(&messages);
    let params = HistoryAroundParams {
        session_id: "c".into(),
        item_id: ids[4].clone(),
        before: Some(1),
        after: Some(1),
        include_descendants: None,
    };
    let options = PageOptions {
        compressed: true,
        ..Default::default()
    };
    let result = prepare(&messages, &params, options);
    assert!(result.updates.is_none());
    assert!(!result.batches.unwrap().is_empty());
}

struct Lending(Vec<DisplayMessage>);

impl ResumePort for Lending {
    fn resume_snapshot<'a>(&'a self, _: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
        unreachable!("a lending port must not hand out an owned copy")
    }
    fn is_running(&self, _: &str) -> bool {
        false
    }
    fn read_messages<'a>(&'a self, _: &'a str, read: MessageReader<'a>) -> BoxFuture<'a, ()> {
        Box::pin(async move { read(&self.0) })
    }
}

#[tokio::test]
async fn with_messages_lends_the_stored_list_instead_of_cloning_it() {
    let port = Lending(transcript(5));
    let lent = with_messages(&port, "c", |messages| messages.as_ptr() as usize).await;
    assert_eq!(lent, Some(port.0.as_ptr() as usize));
    let total = with_messages(&port, "c", |messages| messages.len())
        .await
        .unwrap();
    assert_eq!(total, 10);
}

#[tokio::test]
async fn around_and_page_serve_from_the_lent_list() {
    // `resume_snapshot` panics on this port, so neither may clone.
    let port = Lending(transcript(5));
    let ids = flat_ids(&port.0);
    let params = HistoryAroundParams {
        session_id: "c".into(),
        item_id: ids[7].clone(),
        before: Some(2),
        after: Some(2),
        include_descendants: None,
    };
    let around = crate::history_around::around_chat(&port, &params, PageOptions::default()).await;
    assert_eq!(update_item_ids(&around.unwrap()), ids[5..=9]);
    let page = mainframe_types::acp::extensions::HistoryPageParams {
        session_id: "c".into(),
        before: ids[8].clone(),
        containers: Some(2),
        items: None,
        until_item_id: None,
    };
    let mut inspected = 0;
    let page = crate::history_page::prepare_chat(&port, &page, PageOptions::default(), |m| {
        inspected = m.len();
    })
    .await
    .unwrap();
    assert_eq!(inspected, 10);
    assert!(!page.containers.is_empty());
}

#[tokio::test]
async fn a_panicking_reader_is_contained_and_reported_as_no_result() {
    let port = Lending(transcript(2));
    let lost = with_messages(&port, "c", |_| -> usize { panic!("reader bug") }).await;
    assert_eq!(lost, None);
    // The port is still usable afterwards.
    assert_eq!(with_messages(&port, "c", |m| m.len()).await, Some(4));
}

#[test]
fn a_queued_container_is_valid_but_empty_and_windows_skip_it() {
    let mut messages = transcript(3);
    messages[3].metadata = Some(std::collections::HashMap::from([(
        "queued".to_owned(),
        json!(true),
    )]));
    let empty = around(&messages, "a1", Some(2), Some(2));
    assert_eq!(empty.stale, None);
    assert!(empty.updates.is_none() && empty.first_item_id.is_none());
    assert!(empty.has_before && empty.has_after);
    // A window that skips the queued container still reports exact items.
    let ids = flat_ids(&messages);
    let result = around(&messages, &ids[ids.len() - 1], Some(3), Some(0));
    assert_eq!(update_item_ids(&result), ids[ids.len() - 4..]);
}
