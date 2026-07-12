//! Ported from `packages/types/src/background-task.ts`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundTaskStatus {
    Running,
    Completed,
    Failed,
    Stopped,
}

/// What a CLI background task is, mapped from the CLI's `task_type`
/// (`local_bash` → `bash`, agents/teammates → `agent`, …).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundWorkKind {
    Bash,
    Agent,
    Workflow,
    Other,
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
    pub kind: BackgroundWorkKind,
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

/// One live background task as surfaced to clients (in `Chat.backgroundActivity`
/// and the UI activity bar).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundActivityTask {
    pub id: String,
    pub kind: BackgroundWorkKind,
    pub description: String,
    pub started_at: i64,
}

/// Live background work for a chat — derived from the tracker, never persisted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundActivity {
    pub total: u32,
    /// `Partial<Record<BackgroundWorkKind, number>>` — only positive counts.
    pub by_kind: HashMap<BackgroundWorkKind, u32>,
    pub tasks: Vec<BackgroundActivityTask>,
}

/// Project a tracker task onto its client-facing activity entry (bash tasks often
/// carry the command, not a description).
pub fn to_activity_task(task: &BackgroundTask) -> BackgroundActivityTask {
    BackgroundActivityTask {
        id: task.id.clone(),
        kind: task.kind,
        description: if task.description.is_empty() {
            task.command.clone()
        } else {
            task.description.clone()
        },
        started_at: task.started_at,
    }
}

/// Aggregate live tasks into the `backgroundActivity` payload; `None` when nothing
/// is live.
pub fn derive_background_activity(tasks: &[BackgroundActivityTask]) -> Option<BackgroundActivity> {
    if tasks.is_empty() {
        return None;
    }
    let mut by_kind: HashMap<BackgroundWorkKind, u32> = HashMap::new();
    for task in tasks {
        *by_kind.entry(task.kind).or_insert(0) += 1;
    }
    Some(BackgroundActivity {
        total: tasks.len() as u32,
        by_kind,
        tasks: tasks.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_task() -> BackgroundTask {
        BackgroundTask {
            id: "b-1".to_string(),
            kind: BackgroundWorkKind::Bash,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "tu-1".to_string(),
            command: "pnpm dev".to_string(),
            description: "dev server".to_string(),
            output_path: Some("/tmp/b-1.output".to_string()),
            started_at: 1000,
            ended_at: None,
            status: BackgroundTaskStatus::Running,
            last_output_line: None,
            summary: None,
            usage: None,
            recovered: None,
        }
    }

    #[test]
    fn started_event_matches_fixture_shape() {
        // Mirrors docs/rust-port/fixtures/event.background_task-started.json
        // (minus the `_provenance` tag).
        let json = r#"{"type":"background_task.started","chatId":"chat_9f2a3b1c","task":{"id":"bgt_001","kind":"bash","toolName":"Bash","toolUseId":"toolu_05E","command":"pnpm test --watch","description":"Run tests in watch mode","outputPath":null,"startedAt":1751970000000,"endedAt":null,"status":"running","lastOutputLine":null,"summary":null,"usage":null}}"#;
        let event: BackgroundTaskEvent = serde_json::from_str(json).unwrap();
        assert!(matches!(event, BackgroundTaskEvent::Started { .. }));
        assert_eq!(serde_json::to_string(&event).unwrap(), json);
    }

    #[test]
    fn nullable_fields_serialize_null_not_omitted() {
        let task = BackgroundTask {
            id: "t".to_string(),
            kind: BackgroundWorkKind::Bash,
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
        let json = r#"{"id":"t","kind":"bash","toolName":"Bash","toolUseId":"u","command":"c","description":"d","outputPath":null,"startedAt":1,"endedAt":2,"status":"completed","lastOutputLine":"done","summary":"ok","usage":{"totalTokens":100,"toolUses":3,"durationMs":500},"recovered":true}"#;
        let task: BackgroundTask = serde_json::from_str(json).unwrap();
        assert_eq!(task.recovered, Some(true));
        assert_eq!(serde_json::to_string(&task).unwrap(), json);
    }

    // Translated from packages/types/src/__tests__/background-activity.test.ts.

    #[test]
    fn background_work_kind_accepts_four_kinds() {
        for (raw, kind) in [
            ("bash", BackgroundWorkKind::Bash),
            ("agent", BackgroundWorkKind::Agent),
            ("workflow", BackgroundWorkKind::Workflow),
            ("other", BackgroundWorkKind::Other),
        ] {
            let parsed: BackgroundWorkKind =
                serde_json::from_value(serde_json::Value::String(raw.to_string())).unwrap();
            assert_eq!(parsed, kind);
        }
    }

    #[test]
    fn background_work_kind_rejects_unknown() {
        let res: Result<BackgroundWorkKind, _> =
            serde_json::from_value(serde_json::Value::String("local_bash".to_string()));
        assert!(res.is_err());
    }

    #[test]
    fn to_activity_task_picks_fields() {
        assert_eq!(
            to_activity_task(&make_task()),
            BackgroundActivityTask {
                id: "b-1".to_string(),
                kind: BackgroundWorkKind::Bash,
                description: "dev server".to_string(),
                started_at: 1000,
            }
        );
    }

    #[test]
    fn to_activity_task_falls_back_to_command() {
        let mut task = make_task();
        task.description = String::new();
        assert_eq!(
            to_activity_task(&task),
            BackgroundActivityTask {
                id: "b-1".to_string(),
                kind: BackgroundWorkKind::Bash,
                description: "pnpm dev".to_string(),
                started_at: 1000,
            }
        );
    }

    #[test]
    fn derive_background_activity_empty_is_none() {
        assert_eq!(derive_background_activity(&[]), None);
    }

    #[test]
    fn derive_background_activity_counts_by_kind_and_totals() {
        let mk = |id: &str, kind: BackgroundWorkKind, description: &str| BackgroundActivityTask {
            id: id.to_string(),
            kind,
            description: description.to_string(),
            started_at: 1000,
        };
        let tasks = vec![
            mk("a-1", BackgroundWorkKind::Agent, "reviewer"),
            mk("a-2", BackgroundWorkKind::Agent, "tester"),
            mk("b-1", BackgroundWorkKind::Bash, "dev server"),
            mk("w-1", BackgroundWorkKind::Workflow, "deploy"),
        ];
        let activity = derive_background_activity(&tasks).unwrap();
        assert_eq!(activity.total, 4);
        assert_eq!(activity.by_kind.get(&BackgroundWorkKind::Agent), Some(&2));
        assert_eq!(activity.by_kind.get(&BackgroundWorkKind::Bash), Some(&1));
        assert_eq!(
            activity.by_kind.get(&BackgroundWorkKind::Workflow),
            Some(&1)
        );
        assert_eq!(activity.by_kind.len(), 3);
        assert_eq!(activity.tasks, tasks);
    }

    #[test]
    fn derive_background_activity_json_round_trips() {
        // Stands in for the zod BackgroundActivitySchema validation in TS.
        let activity = derive_background_activity(&[to_activity_task(&make_task())]).unwrap();
        let json = serde_json::to_value(&activity).unwrap();
        let back: BackgroundActivity = serde_json::from_value(json).unwrap();
        assert_eq!(back, activity);
    }
}

// PORT STATUS: packages/types/src/background-task.ts (101 lines)
// confidence: high
// todos: 0
// notes: Main catch-up (#425): BackgroundWorkKind enum (rename_all=lowercase,
// Hash+Eq so it keys byKind); required BackgroundTask.kind (right after id, per TS
// field order — the fixture round-trips reflect the new key); BackgroundActivityTask
// / BackgroundActivity (byKind = HashMap<BackgroundWorkKind,u32>, positive-only) and
// the toActivityTask / deriveBackgroundActivity helpers. deriveBackgroundActivity
// takes &[BackgroundActivityTask] (NOT BackgroundTask) — matches the TS signature +
// its test. total/byKind counts are u32. background-activity.test.ts translated in
// the tests module (the zod-schema assertion → a serde round-trip).
// notes(orig): startedAt/endedAt (epoch ms) and usage counters are i64 — the fixture
// shows bare integers and serde_json emits `.0` for f64, which would break the
// byte-stable round-trip (so the PORTING.md "ms → f64" default is overridden here;
// fixtures win per §4). `string | null` fields (outputPath/lastOutputLine/summary)
// and `number | null` (endedAt) and `usage | null` are required-nullable → Option
// WITHOUT skip (serialize null). Only `recovered?: true` is skip-when-absent. The
// three *Event interfaces collapse into one tagged BackgroundTaskEvent enum.
