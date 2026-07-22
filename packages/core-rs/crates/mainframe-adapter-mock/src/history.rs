use mainframe_types::chat::{ChatMessage, MessageContent, MessageContentNode};

use crate::fixture::{EventDirection, RecordedEvent};

pub(crate) fn recorded_session_id(events: &[RecordedEvent]) -> Option<String> {
    events
        .iter()
        .find(|event| event.dir == EventDirection::Out && event.method == "onInit")
        .and_then(|event| event.args.first())
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

pub(crate) fn remap_history_paths(history: &mut [ChatMessage], project_path: &str) {
    for message in history {
        for content in &mut message.content {
            let MessageContent::Node(MessageContentNode::ToolUse { input, .. }) = content else {
                continue;
            };
            let Some(path) = input.get("file_path").and_then(serde_json::Value::as_str) else {
                continue;
            };
            if let Some(suffix) = recorded_project_suffix(path) {
                input.insert(
                    "file_path".to_string(),
                    serde_json::Value::String(format!("{project_path}/{suffix}")),
                );
            }
        }
    }
}

fn recorded_project_suffix(path: &str) -> Option<&str> {
    let marker = "/mf-e2e-";
    let start = path.find(marker)? + marker.len();
    let slash = path[start..].find('/')? + start;
    path.get(slash + 1..)
}
