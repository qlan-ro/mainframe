//! Ported from `packages/core/src/messages/read-tool-result-from-jsonl.ts`.
//!
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
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("s.jsonl");
        let lines = [
            serde_json::json!({
                "type": "user",
                "message": { "content": [{ "type": "tool_result", "tool_use_id": "tu_1", "content": "FULL CONTENT ONE" }] }
            })
            .to_string(),
            serde_json::json!({
                "type": "user",
                "message": { "content": [{
                    "type": "tool_result",
                    "tool_use_id": "tu_2",
                    "content": [
                        { "type": "text", "text": "PART A" },
                        { "type": "text", "text": "PART B" }
                    ]
                }] }
            })
            .to_string(),
        ];
        std::fs::write(&file, lines.join("\n") + "\n").unwrap();
        (dir, file.to_string_lossy().to_string())
    }

    #[tokio::test]
    async fn returns_full_string_content_by_id() {
        let (_dir, f) = fixture();
        assert_eq!(
            read_tool_result_from_jsonl(&f, "tu_1").await,
            Some("FULL CONTENT ONE".to_string())
        );
    }

    #[tokio::test]
    async fn flattens_array_content_blocks() {
        let (_dir, f) = fixture();
        let r = read_tool_result_from_jsonl(&f, "tu_2").await.unwrap();
        assert!(r.contains("PART A"));
        assert!(r.contains("PART B"));
    }

    #[tokio::test]
    async fn returns_null_when_id_absent() {
        let (_dir, f) = fixture();
        assert_eq!(read_tool_result_from_jsonl(&f, "nope").await, None);
    }

    #[tokio::test]
    async fn returns_null_when_file_missing() {
        assert_eq!(
            read_tool_result_from_jsonl("/no/such/file.jsonl", "tu_1").await,
            None
        );
    }

    #[tokio::test]
    async fn tolerates_partial_trailing_line() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("s.jsonl");
        let mut f = std::fs::File::create(&file).unwrap();
        let good = serde_json::json!({
            "type": "user",
            "message": { "content": [{ "type": "tool_result", "tool_use_id": "tu_9", "content": "OK" }] }
        })
        .to_string();
        write!(f, "{good}\n{{\"type\":\"user\",\"mess").unwrap();
        assert_eq!(
            read_tool_result_from_jsonl(&file.to_string_lossy(), "tu_9").await,
            Some("OK".to_string())
        );
    }
}

// PORT STATUS: src/messages/read-tool-result-from-jsonl.ts (41 lines)
// confidence: high
// todos: 0
// notes: createReadStream+readline → tokio BufReader::lines() (strips CRLF, so
// crlfDelay:Infinity parity holds). The TS catch logs 'error scanning session
// jsonl' and returns null; a missing-file open error takes the same path here.
// Reuses history_tool_result::extract_tool_result_content. All 5 TS tests ported.
