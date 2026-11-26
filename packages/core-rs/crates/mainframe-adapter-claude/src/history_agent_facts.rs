use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use mainframe_types::chat::{ChatMessage, MessageContent, MessageContentNode};
use serde_json::{Value, json};

#[derive(Default)]
pub(super) struct AgentFacts {
    results: HashMap<String, Value>,
    notifications: HashMap<String, Value>,
}

fn terminal(status: &str) -> Option<&'static str> {
    match status {
        "completed" | "success" => Some("completed"),
        "failed" | "error" => Some("failed"),
        "stopped" | "cancelled" | "canceled" => Some("stopped"),
        _ => None,
    }
}

impl AgentFacts {
    pub(super) fn observe(&mut self, entry: &Value) {
        if let Some((id, fact)) = notification(entry) {
            self.notifications.insert(id.to_owned(), fact);
        }
        let Some(result) = entry.get("toolUseResult") else {
            return;
        };
        let Some(blocks) = entry.pointer("/message/content").and_then(Value::as_array) else {
            return;
        };
        for block in blocks {
            if block["type"] == "tool_result"
                && let Some(id) = block["tool_use_id"].as_str()
            {
                let status = result["status"].as_str().and_then(terminal);
                if status.is_some() || result["totalDurationMs"].is_u64() {
                    self.results.insert(
                        id.to_owned(),
                        json!({
                            "status": status.unwrap_or("completed"),
                            "durationMs": result["totalDurationMs"],
                            "toolUseCount": result["totalToolUseCount"],
                            "tokens": result["totalTokens"],
                            "summary": result["summary"],
                            "source": "result"
                        }),
                    );
                }
            }
        }
    }

    pub(super) fn apply(
        &self,
        messages: &mut [ChatMessage],
        agents: &HashMap<String, String>,
        files: &std::collections::HashSet<String>,
    ) {
        let paths: HashMap<_, _> = files
            .iter()
            .filter_map(|file| {
                let agent = Path::new(file)
                    .file_stem()?
                    .to_str()?
                    .strip_prefix("agent-")?;
                Some((agents.get(agent)?.as_str(), file))
            })
            .collect();
        for message in messages {
            let facts: HashMap<_, _> = message
                .content
                .iter()
                .filter_map(|block| {
                    let MessageContent::Node(MessageContentNode::ToolUse {
                        id,
                        name,
                        parent_tool_use_id: None,
                        ..
                    }) = block
                    else {
                        return None;
                    };
                    if !matches!(name.as_str(), "Agent" | "Task") {
                        return None;
                    }
                    let fact = self
                        .results
                        .get(id)
                        .or_else(|| self.notifications.get(id))
                        .cloned()
                        .or_else(|| tail(paths.get(id.as_str())?))
                        .unwrap_or_else(|| json!({"status":"unknown"}));
                    Some((id, fact))
                })
                .collect();
            if !facts.is_empty() {
                message
                    .metadata
                    .get_or_insert_with(HashMap::new)
                    .insert("subagentFacts".into(), json!(facts));
            }
        }
    }
}

fn notification(entry: &Value) -> Option<(&str, Value)> {
    if entry["subtype"] == "task_notification" {
        let id = entry["tool_use_id"].as_str()?;
        let status = terminal(entry["status"].as_str()?)?;
        return Some((
            id,
            json!({
                "status":status, "summary":entry["summary"], "source":"notification",
                "durationMs":entry["usage"]["duration_ms"],
                "tokens":entry["usage"]["total_tokens"], "toolUseCount":entry["usage"]["tool_uses"]
            }),
        ));
    }
    let content = entry.pointer("/message/content")?;
    let text = content
        .as_str()
        .or_else(|| content.pointer("/0/text")?.as_str())?;
    let payload = text
        .trim()
        .strip_prefix("<task-notification>")?
        .strip_suffix("</task-notification>")?;
    let tag = |name: &str| {
        let (_, body) = payload.split_once(&format!("<{name}>"))?;
        Some(body.split_once(&format!("</{name}>"))?.0.trim())
    };
    let id = tag("tool-use-id")?;
    let status = terminal(tag("status")?)?;
    Some((
        id,
        json!({"status":status,"summary":tag("summary"),"source":"notification"}),
    ))
}

fn tail(path: &str) -> Option<Value> {
    const MAX: u64 = 1024 * 1024;
    let mut file = std::fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let mut window = 64 * 1024;
    loop {
        let start = length.saturating_sub(window);
        file.seek(SeekFrom::Start(start)).ok()?;
        let mut bytes = Vec::new();
        (&mut file)
            .take(length - start)
            .read_to_end(&mut bytes)
            .ok()?;
        let mut records = bytes.split(|byte| *byte == b'\n');
        if start != 0 {
            records.next();
        }
        for line in records.rev() {
            let Ok(record) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            return tail_fact(&record);
        }
        if start == 0 || window == MAX {
            return None;
        }
        window *= 2;
    }
}

fn tail_fact(record: &Value) -> Option<Value> {
    if record["type"] == "result" {
        return Some(json!({
            "source":"tail",
            "status":if record["is_error"] == true { "failed" } else { terminal(record["subtype"].as_str()?)? },
            "summary":record["result"],
            "durationMs":record["duration_ms"]
        }));
    }
    if record["type"] != "assistant"
        || record.pointer("/message/stop_reason")?.as_str()? != "end_turn"
    {
        return None;
    }
    let blocks = record.pointer("/message/content")?.as_array()?;
    let summary = blocks
        .iter()
        .rev()
        .find_map(|block| block["text"].as_str())?;
    Some(json!({"status":"completed","summary":summary,"source":"tail"}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(id: &str) -> MessageContent {
        MessageContent::Node(MessageContentNode::ToolUse {
            id: id.into(),
            name: "Agent".into(),
            input: HashMap::new(),
            timing: None,
            command_execution: None,
            parent_tool_use_id: None,
        })
    }

    fn result(id: &str, result: Value) -> Value {
        json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":id}]},
            "toolUseResult":result})
    }

    #[test]
    fn prefers_final_result_then_notification_then_tail() {
        let mut facts = AgentFacts::default();
        facts.observe(&result(
            "final",
            json!({"status":"completed","totalDurationMs":12}),
        ));
        facts.observe(&result(
            "notified",
            json!({"status":"async_launched","agentId":"unused"}),
        ));
        for id in ["final", "notified"] {
            facts.observe(&json!({"type":"user","message":{"content":format!(
                "<task-notification><tool-use-id>{id}</tool-use-id><status>failed</status><summary>Fixture</summary></task-notification>"
            )}}));
        }
        let dir = tempfile::tempdir().unwrap();
        let filename = dir.path().join("agent-child.jsonl");
        let record = json!({"type":"result","subtype":"success","duration_ms":42,
            "result":"x".repeat(70 * 1024)});
        std::fs::write(&filename, format!("{{}}\n{record}\n")).unwrap();
        let mut msg = ChatMessage {
            id: "message".into(),
            chat_id: "session".into(),
            r#type: mainframe_types::chat::ChatMessageType::Assistant,
            content: ["final", "notified", "tail", "unknown"]
                .into_iter()
                .map(call)
                .collect(),
            timestamp: String::new(),
            metadata: None,
        };
        facts.apply(
            std::slice::from_mut(&mut msg),
            &HashMap::from([("child".into(), "tail".into())]),
            &std::collections::HashSet::from([filename.to_str().unwrap().into()]),
        );
        let rows = &msg.metadata.unwrap()["subagentFacts"];
        assert_eq!(rows["final"]["durationMs"], 12);
        assert_eq!(rows["final"]["source"], "result");
        assert_eq!(rows["notified"]["status"], "failed");
        assert_eq!(rows["notified"]["source"], "notification");
        assert_eq!(rows["tail"]["durationMs"], 42);
        assert_eq!(rows["tail"]["source"], "tail");
        assert_eq!(rows["unknown"]["status"], "unknown");
    }

    #[test]
    fn tail_stops_at_one_mebibyte() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let record = json!({"type":"result","subtype":"success","result":"x".repeat(1024 * 1024)});
        std::fs::write(file.path(), record.to_string()).unwrap();
        assert!(tail(file.path().to_str().unwrap()).is_none());
    }
}
