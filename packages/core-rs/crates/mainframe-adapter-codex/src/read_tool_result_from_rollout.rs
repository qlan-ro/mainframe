//! The full text of one tool result in a Codex rollout, for the
//! `GET /api/chats/{id}/tool-result/{toolUseId}` expand route — the Codex
//! counterpart of the Claude adapter's `read_tool_result_from_jsonl`. A
//! tool call's display id is the rollout `call_id`, so the route can look a
//! truncated result up by the id the card already holds.
//!
//! Only the `response_item` records that carry an output are read
//! (`function_call_output`, `custom_tool_call_output`); a shell execution's
//! output is returned with Codex's `Process exited with code N … Output:`
//! header stripped, the same text the transcript card previews.

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::rollout_reconstruct::parse_rollout_output;

#[derive(Deserialize)]
struct Record {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    payload: Option<Payload>,
}

#[derive(Deserialize)]
struct Payload {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    call_id: Option<String>,
    #[serde(default)]
    output: Option<Output>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Output {
    Text(String),
    Blocks(Vec<Block>),
}

#[derive(Deserialize)]
struct Block {
    #[serde(default)]
    text: Option<String>,
}

impl Output {
    fn into_text(self) -> String {
        match self {
            Output::Text(text) => text,
            Output::Blocks(blocks) => blocks.into_iter().filter_map(|b| b.text).collect(),
        }
    }
}

/// The output text of the rollout record whose `call_id` is `call_id`, or
/// `None` when the file cannot be read or holds no such output.
pub async fn read_tool_result_from_rollout(file_path: &str, call_id: &str) -> Option<String> {
    let file = match tokio::fs::File::open(file_path).await {
        Ok(file) => file,
        Err(err) => {
            tracing::warn!(module = "rollout-tool-result", err = %err, file_path = %file_path, "error opening rollout");
            return None;
        }
    };
    let mut lines = BufReader::new(file).lines();
    loop {
        let line = match lines.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) => return None,
            Err(err) => {
                tracing::warn!(module = "rollout-tool-result", err = %err, file_path = %file_path, "error scanning rollout");
                return None;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        // A partially written trailing line is expected while the CLI runs.
        let Ok(record) = serde_json::from_str::<Record>(&line) else {
            continue;
        };
        if let Some(text) = output_for(record, call_id) {
            return Some(text);
        }
    }
}

fn output_for(record: Record, call_id: &str) -> Option<String> {
    if record.kind.as_deref() != Some("response_item") {
        return None;
    }
    let payload = record.payload?;
    let is_output = matches!(
        payload.kind.as_deref(),
        Some("function_call_output") | Some("custom_tool_call_output")
    );
    if !is_output || payload.call_id.as_deref() != Some(call_id) {
        return None;
    }
    let raw = payload.output?.into_text();
    Some(parse_rollout_output(&raw).1)
}

#[cfg(test)]
#[path = "read_tool_result_from_rollout_tests.rs"]
mod tests;
