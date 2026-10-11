//! Streams a session JSONL file line-by-line looking for a single tool_result by
//! id. Tolerates a partial trailing line (the CLI may be mid-write).

use crate::history_tool_result::extract_tool_result_content;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};

pub async fn read_tool_result_from_jsonl(file_path: &str, tool_use_id: &str) -> Option<String> {
    let file = match tokio::fs::File::open(file_path).await {
        Ok(f) => f,
        Err(err) => {
            tracing::warn!(
                module = "jsonl-tool-result",
                err = %err,
                file_path = %file_path,
                "error scanning session jsonl"
            );
            return None;
        }
    };
    let mut lines = BufReader::new(file).lines();
    loop {
        let line = match lines.next_line().await {
            Ok(Some(l)) => l,
            Ok(None) => break,
            Err(err) => {
                tracing::warn!(
                    module = "jsonl-tool-result",
                    err = %err,
                    file_path = %file_path,
                    "error scanning session jsonl"
                );
                return None;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let row: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue, // tolerate a partially-written trailing line
        };
        let content = row.get("message").and_then(|m| m.get("content"));
        let arr = match content.and_then(Value::as_array) {
            Some(a) => a,
            None => continue,
        };
        for block in arr {
            if block.is_object()
                && block.get("type").and_then(Value::as_str) == Some("tool_result")
                && block.get("tool_use_id").and_then(Value::as_str) == Some(tool_use_id)
            {
                return Some(extract_tool_result_content(block.get("content")));
            }
        }
    }
    None
}

#[cfg(test)]
#[path = "read_tool_result_from_jsonl_tests.rs"]
mod tests;
