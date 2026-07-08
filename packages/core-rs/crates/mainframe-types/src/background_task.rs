//! Ported from `packages/types/src/background-task.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundTaskStatus {
    Running,
    Completed,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackgroundTaskToolName {
    Bash,
    Monitor,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskUsage {
    pub total_tokens: i64,
    pub tool_uses: i64,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTask {
    pub id: String,
    pub tool_name: BackgroundTaskToolName,
    pub tool_use_id: String,
    pub command: String,
    pub description: String,
    pub output_path: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub status: BackgroundTaskStatus,
    pub last_output_line: Option<String>,
    pub summary: Option<String>,
    pub usage: Option<BackgroundTaskUsage>,
    /// True when this entry was rehydrated by reconciliation, not produced by a
    /// live CLI session. Optional; the TS type only ever holds `true`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovered: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BackgroundTaskEvent {
    #[serde(rename = "background_task.started", rename_all = "camelCase")]
    Started {
        chat_id: String,
        task: BackgroundTask,
    },
    #[serde(rename = "background_task.updated", rename_all = "camelCase")]
    Updated {
        chat_id: String,
        task: BackgroundTask,
    },
    #[serde(rename = "background_task.ended", rename_all = "camelCase")]
    Ended {
        chat_id: String,
        task: BackgroundTask,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn started_event_matches_fixture_shape() {
        // Mirrors docs/rust-port/fixtures/event.background_task-started.json
        // (minus the `_provenance` tag).
        let json = r#"{"type":"background_task.started","chatId":"chat_9f2a3b1c","task":{"id":"bgt_001","toolName":"Bash","toolUseId":"toolu_05E","command":"pnpm test --watch","description":"Run tests in watch mode","outputPath":null,"startedAt":1751970000000,"endedAt":null,"status":"running","lastOutputLine":null,"summary":null,"usage":null}}"#;
        let event: BackgroundTaskEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, BackgroundTaskEvent::Started { .. }));
        assert_eq!(serde_json::to_string(&event).unwrap(), json);
    }

    #[test]
    fn nullable_fields_serialize_null_not_omitted() {
        let task = BackgroundTask {
            id: "t".to_string(),
            tool_name: BackgroundTaskToolName::Monitor,
            tool_use_id: "u".to_string(),
            command: "c".to_string(),
            description: "d".to_string(),
            output_path: None,
            started_at: 1,
            ended_at: None,
            status: BackgroundTaskStatus::Running,
            last_output_line: None,
            summary: None,
            usage: None,
            recovered: None,
        };
        let s = serde_json::to_string(&task).unwrap();
        assert!(s.contains(r#""outputPath":null"#));
        assert!(s.contains(r#""endedAt":null"#));
        assert!(s.contains(r#""usage":null"#));
        // `recovered` is the only skip-when-absent field.
        assert!(!s.contains("recovered"));
    }

    #[test]
    fn recovered_true_round_trips() {
        let json = r#"{"id":"t","toolName":"Bash","toolUseId":"u","command":"c","description":"d","outputPath":null,"startedAt":1,"endedAt":2,"status":"completed","lastOutputLine":"done","summary":"ok","usage":{"totalTokens":100,"toolUses":3,"durationMs":500},"recovered":true}"#;
        let task: BackgroundTask = serde_json::from_str(json).unwrap();
        assert_eq!(task.recovered, Some(true));
        assert_eq!(serde_json::to_string(&task).unwrap(), json);
    }
}

// PORT STATUS: packages/types/src/background-task.ts (45 lines)
// confidence: high
// todos: 0
// notes: startedAt/endedAt (epoch ms) and usage counters are i64 — the fixture
// shows bare integers and serde_json emits `.0` for f64, which would break the
// byte-stable round-trip (so the PORTING.md "ms → f64" default is overridden here;
// fixtures win per §4). `string | null` fields (outputPath/lastOutputLine/summary)
// and `number | null` (endedAt) and `usage | null` are required-nullable → Option
// WITHOUT skip (serialize null). Only `recovered?: true` is skip-when-absent. The
// three *Event interfaces collapse into one tagged BackgroundTaskEvent enum.
