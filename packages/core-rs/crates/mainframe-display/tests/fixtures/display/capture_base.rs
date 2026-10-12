#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]
use mainframe_adapter_claude::messages::display_pipeline::prepare_messages_for_client;
use mainframe_adapter_codex::{history::convert_thread_items, item_types::ThreadItem};
use mainframe_types::{chat::ChatMessage, display::ToolCategories};
use serde_json::json;
use std::{collections::HashMap, path::Path};

fn categories(provider: &str) -> ToolCategories {
    let (explore, hidden, progress, subagent): (&[&str], &[&str], &[&str], &[&str]) = match provider
    {
        "codex" => (&[], &["todo_list"], &["todo_list"], &["CollabAgent"]),
        "mock" => (
            &["Read", "Glob", "Grep", "LS"],
            &[],
            &["TaskCreate", "TaskUpdate"],
            &["Task", "Agent"],
        ),
        _ => (
            &["Read", "Glob", "Grep", "LS"],
            &[
                "TodoWrite",
                "TaskCreate",
                "TaskUpdate",
                "TaskList",
                "TaskGet",
                "TaskOutput",
                "TaskStop",
                "EnterPlanMode",
                "AskUserQuestion",
                "ToolSearch",
            ],
            &["TaskCreate", "TaskUpdate"],
            &["Task", "Agent"],
        ),
    };
    ToolCategories {
        explore: explore.iter().map(|s| s.to_string()).collect(),
        hidden: hidden.iter().map(|s| s.to_string()).collect(),
        progress: progress.iter().map(|s| s.to_string()).collect(),
        subagent: subagent.iter().map(|s| s.to_string()).collect(),
    }
}

fn codex() -> Vec<ChatMessage> {
    let items: Vec<ThreadItem> = serde_json::from_value(json!([
        {"id":"u1","type":"userMessage","content":[{"type":"text","text":"Inspect and fix the parser"}]},
        {"id":"a1","type":"agentMessage","text":"Checking the parser.","phase":"commentary"},
        {"id":"todo","type":"todoList","items":[{"text":"Inspect parser","completed":false}]},
        {"id":"cmd","type":"commandExecution","command":"cat src/parser.rs","aggregatedOutput":"fn parse() {}","exitCode":0,"status":"completed", "commandActions":[{"type":"read","command":"cat src/parser.rs","name":"parser.rs","path":"src/parser.rs"}], "durationMs":1234},
        {"id":"file","type":"fileChange","status":"completed","changes":[{"path":"src/parser.rs","kind":{"type":"update"},"diff":"@@ -1 +1 @@\n-fn parse() {}\n+fn parse() { validate(); }\n"}]},
        {"id":"collab","type":"collabAgentToolCall","tool":"wait","status":"completed","receiverThreadIds":["child"],"agentsStates":{"child":{"status":"completed","message":"Parser reviewed"}}},
        {"id":"a2","type":"agentMessage","text":"Parser fixed and reviewed.","phase":"final_answer"}
    ])).unwrap();
    let mut raw = convert_thread_items(&items, "golden", &HashMap::new(), &HashMap::new());
    raw.insert(2, serde_json::from_value(json!({
        "id":"todo-live", "chatId":"golden", "type":"assistant", "timestamp":"t",
        "content":[{"type":"tool_use","id":"todo-live", "name":"todo_list", "input":{"items":[{"text":"Inspect parser","completed":false}]}}]
    })).unwrap());
    for message in &mut raw {
        message.timestamp = "2026-10-07T12:00:00Z".into();
    }
    raw
}

#[test]
fn capture_base() {
    let dir = std::env::var("R2_GOLDEN_DIR").unwrap();
    let root = Path::new(&dir);
    std::fs::write(
        root.join("codex.raw.json"),
        serde_json::to_vec_pretty(&serde_json::to_value(codex()).unwrap()).unwrap(),
    )
    .unwrap();
    for provider in ["claude", "codex", "mock"] {
        let raw: Vec<ChatMessage> = serde_json::from_slice(
            &std::fs::read(root.join(format!("{provider}.raw.json"))).unwrap(),
        )
        .unwrap();
        let cats = categories(provider);
        std::fs::write(
            root.join(format!("{provider}.categories.json")),
            serde_json::to_vec_pretty(&serde_json::to_value(&cats).unwrap()).unwrap(),
        )
        .unwrap();
        let display = prepare_messages_for_client(&raw, Some(&cats));
        std::fs::write(
            root.join(format!("{provider}.display.golden")),
            serde_json::to_vec_pretty(&serde_json::to_value(display).unwrap()).unwrap(),
        )
        .unwrap();
    }
}
