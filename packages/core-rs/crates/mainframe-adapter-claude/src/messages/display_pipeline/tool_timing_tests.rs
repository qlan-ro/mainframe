use super::*;
use serde_json::{Value, json};

fn raw(content: Value) -> ChatMessage {
    serde_json::from_value(json!({"id":"container","chatId":"c","type":"assistant",
        "timestamp":"2026-10-02T00:00:00Z","content":content}))
    .unwrap()
}

fn call(id: &str, name: &str, timing: Value) -> Value {
    let mut call = json!({"type":"tool_use","id":id,"name":name,"input":{}});
    if !timing.is_null() {
        call["timing"] = timing;
    }
    call
}

fn collect(value: &Value, out: &mut Vec<(String, Value)>) {
    match value {
        Value::Array(items) => items.iter().for_each(|item| collect(item, out)),
        Value::Object(map) => {
            let id = map.get("agentId").or_else(|| {
                (map.get("type").and_then(Value::as_str) == Some("tool_call")
                    || map.contains_key("category"))
                .then(|| map.get("id"))
                .flatten()
            });
            if let Some(id) = id.and_then(Value::as_str) {
                out.push((id.to_owned(), value["timing"].clone()));
            }
            for key in ["content", "calls", "items"] {
                if let Some(child) = map.get(key) {
                    collect(child, out);
                }
            }
        }
        _ => {}
    }
}

fn timings(messages: &[DisplayMessage]) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    collect(&serde_json::to_value(messages).unwrap(), &mut out);
    out
}

#[test]
fn tool_timing_pipeline_preserves_independent_calls_after_grouping() {
    let messages = vec![raw(json!([
        call("a", "Read", json!({"startedAt":1000,"completedAt":1200})),
        call("b", "Read", json!({"startedAt":1100})),
        call("legacy", "Read", Value::Null)
    ]))];
    let categories = ToolCategories {
        explore: HashSet::from(["Read".into()]),
        hidden: HashSet::new(),
        progress: HashSet::new(),
        subagent: HashSet::new(),
    };
    let expected = vec![
        ("a".into(), json!({"startedAt":1000,"completedAt":1200})),
        ("b".into(), json!({"startedAt":1100})),
        ("legacy".into(), Value::Null),
    ];
    assert_eq!(
        timings(&prepare_messages_for_client(&messages, None)),
        expected
    );
    assert_eq!(
        timings(&prepare_messages_for_client(&messages, Some(&categories))),
        expected
    );
}

#[test]
fn tool_timing_pipeline_keeps_task_parent_child_and_progress_distinct() {
    let mut child = call(
        "child",
        "Read",
        json!({"startedAt":1100,"completedAt":1200}),
    );
    child["parentToolUseId"] = json!("parent");
    let mut parent = call(
        "parent",
        "Task",
        json!({"startedAt":1000,"completedAt":1300}),
    );
    parent["input"] = json!({"description":"inspect"});
    let messages = vec![raw(json!([parent, child,
        call("progress","TaskCreate",json!({"startedAt":1400,"completedAt":1500})),
        {"type":"tool_result","toolUseId":"child","content":"","isError":false,"parentToolUseId":"parent"},
        {"type":"tool_result","toolUseId":"parent","content":"failed","isError":true}
    ]))];
    let categories = ToolCategories {
        explore: HashSet::from(["Read".into()]),
        hidden: HashSet::new(),
        progress: HashSet::from(["TaskCreate".into()]),
        subagent: HashSet::from(["Task".into()]),
    };
    let display = prepare_messages_for_client(&messages, Some(&categories));
    assert_eq!(
        timings(&display),
        vec![
            (
                "parent".into(),
                json!({"startedAt":1000,"completedAt":1300})
            ),
            ("child".into(), json!({"startedAt":1100,"completedAt":1200})),
            (
                "progress".into(),
                json!({"startedAt":1400,"completedAt":1500})
            )
        ]
    );
    let out = serde_json::to_value(&display).unwrap();
    assert_eq!(out[0]["content"][0]["type"], "task_group");
    assert_eq!(out[0]["content"][0]["result"]["isError"], true);
    assert_eq!(out[0]["content"][0]["calls"][0]["result"]["content"], "");
    assert_eq!(out[0]["content"][1]["type"], "task_progress");
}

#[test]
fn tool_timing_pipeline_container_changes_and_replay_preserve_identity() {
    let messages = vec![raw(json!([call("a", "Bash", json!({"startedAt":1000}))]))];
    let first = prepare_messages_for_client(&messages, None);
    let mut regrouped = messages.clone();
    regrouped[0].id = "different-container".into();
    regrouped[0].timestamp = "2026-10-03T00:00:00Z".into();
    let replay = prepare_messages_for_client(&regrouped, None);
    assert_ne!(first[0].id, replay[0].id);
    assert_eq!(timings(&first), timings(&replay));
    assert_eq!(replay, prepare_messages_for_client(&regrouped, None));
}
