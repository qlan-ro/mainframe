#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::Recorder;
use mainframe_adapter_codex::event_mapper::{CodexSessionState, handle_notification};
use mainframe_adapter_codex::history::convert_thread_items;
use mainframe_adapter_codex::types::ThreadReadResult;
use serde_json::{Value, json};
use std::collections::HashMap;

fn cases() -> Vec<(Option<Value>, Option<i64>)> {
    vec![
        (Some(json!("1234")), None),
        (Some(json!(1.5)), None),
        (Some(json!(1234.0)), None),
        (Some(json!(true)), None),
        (Some(json!([])), None),
        (Some(json!({})), None),
        (Some(json!(u64::MAX)), None),
        (Some(Value::Null), None),
        (None, None),
        (Some(json!(0)), Some(0)),
        (Some(json!(1234)), Some(1234)),
        (Some(json!(i64::MIN)), Some(i64::MIN)),
        (Some(json!(i64::MAX)), Some(i64::MAX)),
    ]
}

fn command(duration: Option<Value>) -> Value {
    let mut item = json!({
        "type":"commandExecution", "id":"cmd", "command":"cat a", "status":"completed",
        "aggregatedOutput":"output\n", "exitCode":1,
        "commandActions":[{"type":"read","command":"cat a","name":"a","path":"a"}]
    });
    if let Some(duration) = duration {
        item["durationMs"] = duration;
    }
    item
}

fn assert_command(call: Value, result: Value, duration: Option<i64>) {
    assert_eq!(call["id"], "cmd");
    assert_eq!(call["name"], "Bash");
    assert_eq!(call["input"], json!({"command":"cat a"}));
    assert_eq!(
        call["commandExecution"]["commandActions"],
        command(None)["commandActions"]
    );
    assert_eq!(
        call["commandExecution"].get("reportedDurationMs"),
        duration.map(|d| json!(d)).as_ref()
    );
    assert_eq!(result["toolUseId"], "cmd");
    assert_eq!(result["content"], "output\n");
    assert_eq!(result["isError"], true);
}

#[test]
fn command_duration_live_completion_keeps_bash_when_optional_duration_is_malformed() {
    for (raw, expected) in cases() {
        let rec = Recorder::new();
        handle_notification(
            "item/completed",
            &json!({"threadId":"t", "turnId":"turn", "item":command(raw.clone())}),
            &rec.sink(),
            &mut CodexSessionState::default(),
        );
        assert_eq!(rec.messages().len(), 1, "duration: {raw:?}");
        assert_eq!(rec.tool_results().len(), 1, "duration: {raw:?}");
        assert_command(
            serde_json::to_value(&rec.messages()[0][0]).unwrap(),
            serde_json::to_value(&rec.tool_results()[0][0]).unwrap(),
            expected,
        );
    }
}

#[test]
fn command_duration_thread_read_keeps_bash_when_optional_duration_is_malformed() {
    for (raw, expected) in cases() {
        let response = json!({"thread":{"id":"t","turns":[{
            "id":"turn", "status":"completed", "items":[command(raw.clone())]
        }]}});
        let parsed: ThreadReadResult = serde_json::from_str(&response.to_string()).unwrap();
        let turns = parsed.thread.turns.unwrap();
        assert_eq!(turns[0].items.len(), 1, "duration: {raw:?}");
        let history =
            convert_thread_items(&turns[0].items, "chat", &HashMap::new(), &HashMap::new());
        assert_eq!(history.len(), 2, "duration: {raw:?}");
        assert_command(
            serde_json::to_value(&history[0].content[0]).unwrap(),
            serde_json::to_value(&history[1].content[0]).unwrap(),
            expected,
        );
    }
}
