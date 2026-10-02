use super::*;
use serde_json::{Value, json};

fn raw(id: &str, timing: Value) -> ChatMessage {
    serde_json::from_value(
        json!({"id":id,"chatId":"c","type":"assistant","timestamp":"2026-10-02T00:00:00Z",
        "content":[{"type":"tool_use","id":id,"name":"Bash","input":{},"timing":timing}]}),
    )
    .unwrap()
}

#[test]
fn tool_timing_projection_recurses_without_inheriting_parent_or_wrapper_times() {
    let raw = vec![
        raw("parent", json!({"startedAt":1000,"completedAt":1300})),
        raw("child", json!({"startedAt":1100})),
        raw("progress", json!({"startedAt":1200,"completedAt":1250})),
    ];
    let mut display = vec![serde_json::from_value(json!({"id":"container","chatId":"c","type":"assistant","timestamp":"2026-10-02T00:00:00Z",
        "content":[{"type":"task_group","agentId":"parent","taskArgs":{},"calls":[
            {"type":"tool_group","calls":[{"type":"tool_call","id":"child","name":"Bash","input":{},"category":"default"},
                {"type":"tool_call","id":"unknown","name":"Bash","input":{},"category":"default"}]},
            {"type":"task_progress","items":[{"id":"progress","name":"TaskUpdate","input":{},"category":"progress"}]}]}]})).unwrap()];
    apply_tool_call_timing(&raw, &mut display);
    let out = serde_json::to_value(&display).unwrap();
    let parent = &out[0]["content"][0];
    assert_eq!(
        parent["timing"],
        json!({"startedAt":1000,"completedAt":1300})
    );
    let group = &parent["calls"][0];
    assert!(group.get("timing").is_none());
    assert_eq!(group["calls"][0]["timing"], json!({"startedAt":1100}));
    assert!(group["calls"][1].get("timing").is_none());
    assert_eq!(
        parent["calls"][1]["items"][0]["timing"],
        json!({"startedAt":1200,"completedAt":1250})
    );
    apply_tool_call_timing(&raw, &mut display);
    assert_eq!(serde_json::to_value(&display).unwrap(), out);
}
