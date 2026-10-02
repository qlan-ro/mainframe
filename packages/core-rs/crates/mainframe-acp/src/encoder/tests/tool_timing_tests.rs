use super::*;

fn call(id: &str, timing: Value, result: Value) -> Value {
    json!({"type":"tool_call","id":id,"name":"Read","input":{},"category":"explore", "timing":timing,"result":result})
}

fn encoded(content: Value) -> Vec<EncodedItem> {
    let content: Vec<DisplayContent> = serde_json::from_value(content).unwrap();
    encode(&[dmsg("container", DisplayMessageType::Assistant, content)])
}

fn metadata(item: &EncodedItem) -> &Value {
    let EncodedItem::ToolCall {
        meta: Some(meta), ..
    } = item
    else {
        panic!("expected tool metadata");
    };
    &meta[MAINFRAME_META_NAMESPACE]
}

#[test]
fn tool_timing_encoder_carries_independent_empty_success_and_failure_times() {
    let items = encoded(json!([
        call(
            "a",
            json!({"startedAt":1000,"completedAt":1200}),
            json!({"content":"","isError":false})
        ),
        call(
            "b",
            json!({"startedAt":1100,"completedAt":1300}),
            json!({"content":"","isError":true})
        ),
        call("legacy", Value::Null, Value::Null)
    ]));
    assert_eq!(
        metadata(&items[0])["toolCallTiming"],
        json!({"startedAt":1000,"completedAt":1200})
    );
    assert_eq!(
        metadata(&items[1])["toolCallTiming"],
        json!({"startedAt":1100,"completedAt":1300})
    );
    assert_eq!(
        metadata(&items[0])["timestamp"],
        metadata(&items[1])["timestamp"]
    );
    assert!(metadata(&items[2]).get("toolCallTiming").is_none());
    for (item, expected) in items.iter().zip([
        ToolCallStatus::Completed,
        ToolCallStatus::Failed,
        ToolCallStatus::InProgress,
    ]) {
        let EncodedItem::ToolCall { status, .. } = item else {
            panic!("expected tool");
        };
        assert_eq!(*status, expected);
    }
}

#[test]
fn tool_timing_encoder_covers_grouped_nested_and_progress_calls() {
    let content = json!([
        {"type":"tool_group","calls":[call("a",json!({"startedAt":1000}),Value::Null),call("b",json!({"startedAt":1100}),Value::Null)]},
        {"type":"task_group","agentId":"parent","taskArgs":{},"timing":{"startedAt":1200,"completedAt":1500},"calls":[
            call("child",json!({"startedAt":1300,"completedAt":1400}),Value::Null),call("untimed",Value::Null,Value::Null),
            {"type":"task_progress","items":[{"id":"progress","name":"TaskCreate","input":{},"category":"progress","timing":{"startedAt":1350}}]}]}
    ]);
    let items = encoded(content.clone());
    assert_eq!(
        items.iter().map(EncodedItem::id).collect::<Vec<_>>(),
        ["a", "b", "parent", "child", "untimed", "progress"]
    );
    assert_eq!(metadata(&items[0])["groupId"], "a");
    assert_eq!(
        metadata(&items[1])["toolCallTiming"],
        json!({"startedAt":1100})
    );
    assert_eq!(
        metadata(&items[2])["toolCallTiming"],
        json!({"startedAt":1200,"completedAt":1500})
    );
    assert_eq!(
        metadata(&items[3])["toolCallTiming"],
        json!({"startedAt":1300,"completedAt":1400})
    );
    assert_eq!(metadata(&items[3])["parentToolCallId"], "parent");
    assert!(metadata(&items[4]).get("toolCallTiming").is_none());
    assert_eq!(
        metadata(&items[5])["toolCallTiming"],
        json!({"startedAt":1350})
    );
    assert_eq!(items, encoded(content));
}
