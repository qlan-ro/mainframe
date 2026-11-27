use crate::history_around::{MAX_DESCENDANTS, prepare};
use crate::history_page::PageOptions;
use mainframe_types::acp::extensions::{HistoryAroundParams, HistoryAroundResult};
use mainframe_types::display::DisplayMessage;
use serde_json::json;

fn update_item_ids(result: &HistoryAroundResult) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
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

fn around(
    messages: &[DisplayMessage],
    item: &str,
    descendants: Option<bool>,
) -> HistoryAroundResult {
    let params = HistoryAroundParams {
        session_id: "c".into(),
        item_id: item.into(),
        before: Some(0),
        after: Some(0),
        include_descendants: descendants,
    };
    prepare(messages, &params, PageOptions::default())
}

fn agents(steps: &[usize]) -> Vec<DisplayMessage> {
    let groups: Vec<_> = steps
        .iter()
        .enumerate()
        .map(|(group, count)| {
            let calls: Vec<_> = (0..*count)
                .map(|i| {
                    json!({"type":"tool_call","id":format!("g{group}c{i}"),"name":"Read","input":{},
                    "category":"default","result":{"content":"ok","isError":false}})
                })
                .collect();
            json!({"type":"task_group","agentId":format!("agent{group}"),"taskArgs":{},"calls":calls})
        })
        .collect();
    vec![
        serde_json::from_value(json!({"id":"big","chatId":"c","type":"assistant",
            "timestamp":"now","content":groups}))
        .unwrap(),
    ]
}

#[test]
fn descendants_are_not_returned_unless_asked() {
    let messages = agents(&[3]);
    let result = around(&messages, "agent0", None);
    assert_eq!(update_item_ids(&result), vec!["tool:agent0".to_owned()]);
}

#[test]
fn a_sub_agents_steps_come_with_its_call_and_no_other_agents() {
    let messages = agents(&[3, 2]);
    let result = around(&messages, "agent0", Some(true));
    assert_eq!(
        update_item_ids(&result),
        ["tool:agent0", "tool:g0c0", "tool:g0c1", "tool:g0c2"]
    );
    assert_eq!(result.target_item_id.as_deref(), Some("tool:agent0"));
    assert_eq!(result.last_item_id.as_deref(), Some("tool:g0c2"));
    assert_eq!(result.has_more_descendants, None);
    assert!(!result.has_before);
    assert!(result.has_after, "the second agent still follows");
}

#[test]
fn the_cap_keeps_the_newest_steps_with_the_call_as_context_and_says_so() {
    let extra = 5;
    let messages = agents(&[MAX_DESCENDANTS + extra]);
    let result = around(&messages, "agent0", Some(true));
    let ids = update_item_ids(&result);
    assert_eq!(ids.len(), MAX_DESCENDANTS + 1);
    assert_eq!(ids[0], "tool:agent0");
    assert_eq!(ids[1], format!("tool:g0c{extra}"));
    assert_eq!(
        ids.last().unwrap(),
        &format!("tool:g0c{}", MAX_DESCENDANTS + extra - 1)
    );
    assert_eq!(result.has_more_descendants, Some(true));
    assert_eq!(result.target_item_id.as_deref(), Some("tool:agent0"));
    assert_eq!(
        result.context_item_ids,
        Some(vec!["tool:agent0".to_owned()])
    );
    assert_eq!(result.first_item_id.as_deref(), Some(ids[1].as_str()));
    assert!(result.has_before);
}

#[test]
fn exactly_the_cap_is_not_cut() {
    let messages = agents(&[MAX_DESCENDANTS]);
    let result = around(&messages, "agent0", Some(true));
    assert_eq!(update_item_ids(&result).len(), MAX_DESCENDANTS + 1);
    assert_eq!(result.has_more_descendants, None);
}
