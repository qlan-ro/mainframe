use crate::display_tool_groups::apply_tool_grouping;
use mainframe_types::display::{DisplayContent, ToolCategories};
use serde_json::{Value, json};
use std::collections::HashSet;

fn result(id: &str) -> Value {
    json!({
        "content": format!("{id}:unicode 🦀 {}", "x".repeat(32768)),
        "isError": true,
        "structuredPatch": [],
        "originalFile": "before",
        "modifiedFile": "after",
        "truncated": true,
        "fullBytes": 90000,
        "askUserQuestion": [{"question":"q","answer":["a"],"preview":"p","notes":"n"}],
        "images": [{"mediaType":"image/png","data":"aW1hZ2U="}]
    })
}

fn call(id: &str, name: &str, parent: Option<&str>) -> DisplayContent {
    serde_json::from_value(json!({
        "type":"tool_call", "id":id, "name":name, "input":{},
        "category":"default", "result": result(id), "parentToolUseId":parent
    }))
    .unwrap()
}

#[test]
fn grouping_preserves_complete_typed_results_for_every_output_shape() {
    let categories = ToolCategories {
        explore: HashSet::from(["Read".into()]),
        subagent: HashSet::from(["Task".into()]),
        progress: HashSet::from(["TaskCreate".into()]),
        hidden: HashSet::new(),
    };
    let original = vec![
        call("read-a", "Read", None),
        call("read-b", "Read", None),
        call("task", "Task", None),
        call("child-a", "Read", Some("task")),
        call("child-b", "Read", Some("task")),
        call("child", "Bash", Some("task")),
        call("progress", "TaskCreate", None),
        call("ordinary", "Bash", None),
    ];
    let grouped = serde_json::to_value(apply_tool_grouping(original, &categories)).unwrap();
    let mut found = Vec::new();
    collect_results(&grouped, &mut found);
    found.sort();
    assert_eq!(
        found,
        [
            "child", "child-a", "child-b", "ordinary", "progress", "read-a", "read-b", "task"
        ]
    );
}

fn collect_results(value: &Value, found: &mut Vec<String>) {
    match value {
        Value::Array(values) => values.iter().for_each(|v| collect_results(v, found)),
        Value::Object(object) => {
            if let Some(actual) = object.get("result") {
                let id = object
                    .get("id")
                    .or_else(|| object.get("agentId"))
                    .unwrap()
                    .as_str()
                    .unwrap();
                assert_eq!(*actual, result(id));
                found.push(id.to_owned());
            }
            for (key, child) in object {
                if key != "result" {
                    collect_results(child, found);
                }
            }
        }
        _ => {}
    }
}
