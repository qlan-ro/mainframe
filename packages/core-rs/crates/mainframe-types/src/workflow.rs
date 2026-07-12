//! Ported from `packages/types/src/workflow.ts`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuestionFieldType {
    Text,
    Number,
    Choice,
    Multi,
    Textarea,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuestionFieldWhen {
    pub key: String,
    pub equals: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuestionField {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: QuestionFieldType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<QuestionFieldWhen>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowRunStatus {
    Running,
    Waiting,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowStepStatus {
    Running,
    Waiting,
    Succeeded,
    Failed,
    Skipped,
    Ambiguous,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowTriggerKind {
    Manual,
    Schedule,
    Event,
    Webhook,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkflowTrigger {
    pub kind: WorkflowTriggerKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub project_id: Option<String>,
    pub file_path: String,
    pub triggers: Vec<WorkflowTrigger>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowRunTriggerKind {
    Manual,
    Cron,
    Event,
    Call,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkflowBannerAction {
    Answer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkflowBannerCta {
    pub label: String,
    pub action: WorkflowBannerAction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunSummary {
    pub id: String,
    pub workflow_id: String,
    pub status: WorkflowRunStatus,
    pub trigger_kind: WorkflowRunTriggerKind,
    pub parent_run_id: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
    /// `outputs: unknown` — arbitrary JSON; the `minimal` fixture shows explicit
    /// `null`, so this is a required Value (Value::Null serializes as null).
    pub outputs: Value,
    /// Daemon-supplied status-tinted narrative shown for ANY run status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub banner: Option<String>,
    /// Optional CTA button rendered in the run's own status color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub banner_cta: Option<WorkflowBannerCta>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepSummary {
    pub step_path: String,
    pub step_id: Option<String>,
    pub kind: String,
    pub attempt: i64,
    pub status: WorkflowStepStatus,
    // input/output are display-truncated by the API layer (full values stay in run_values).
    pub input: Value,
    pub output: Value,
    pub truncated: bool,
    pub error: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowInteractionSummary {
    pub id: String,
    pub run_id: String,
    pub step_path: String,
    pub title: String,
    // Optional human-readable question text shown under the title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    pub form_schema: Vec<QuestionField>,
    pub created_at: i64,
    pub expires_at: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_summary_minimal_round_trips() {
        // Mirrors the `minimal` variant of event.workflow-run-updated.json's `run`.
        let json = r#"{"id":"run_001","workflowId":"wf_release","status":"running","triggerKind":"manual","parentRunId":null,"startedAt":1751970000000,"finishedAt":null,"error":null,"outputs":null}"#;
        let run: WorkflowRunSummary = serde_json::from_str(json).unwrap();
        assert_eq!(run.status, WorkflowRunStatus::Running);
        assert!(run.outputs.is_null());
        assert_eq!(serde_json::to_string(&run).unwrap(), json);
    }

    #[test]
    fn run_summary_full_round_trips() {
        let json = r#"{"id":"run_002","workflowId":"wf_release","status":"succeeded","triggerKind":"manual","parentRunId":null,"startedAt":1751970000000,"finishedAt":1751970500000,"error":null,"outputs":{"releaseTag":"v1.4.0"},"banner":"Release v1.4.0 published successfully.","bannerCta":{"label":"View run","action":"answer"}}"#;
        let run: WorkflowRunSummary = serde_json::from_str(json).unwrap();
        assert_eq!(run.finished_at, Some(1751970500000));
        assert_eq!(
            run.banner_cta,
            Some(WorkflowBannerCta {
                label: "View run".to_string(),
                action: WorkflowBannerAction::Answer
            })
        );
        assert_eq!(serde_json::to_string(&run).unwrap(), json);
    }

    #[test]
    fn interaction_minimal_omits_prompt_and_serializes_null_expires() {
        let json = r#"{"id":"wint_001","runId":"run_001","stepPath":"root.ask","title":"Confirm deploy target","formSchema":[{"key":"target","type":"choice","options":["staging","production"],"required":true}],"createdAt":1751970000000,"expiresAt":null}"#;
        let i: WorkflowInteractionSummary = serde_json::from_str(json).unwrap();
        assert!(i.prompt.is_none());
        assert!(i.expires_at.is_none());
        assert_eq!(serde_json::to_string(&i).unwrap(), json);
    }

    #[test]
    fn question_field_renames_type() {
        let json = r#"{"key":"target","type":"choice","options":["a","b"],"required":true}"#;
        let f: QuestionField = serde_json::from_str(json).unwrap();
        assert_eq!(f.field_type, QuestionFieldType::Choice);
        assert_eq!(serde_json::to_string(&f).unwrap(), json);
    }
}

// PORT STATUS: packages/types/src/workflow.ts (66 lines)
// confidence: high
// todos: 0
// notes: two `triggerKind` vocabularies differ (WorkflowSummary.triggers.kind =
// manual|schedule|event|webhook vs WorkflowRunSummary.triggerKind =
// manual|cron|event|call) → two enums. `type` field renamed to `field_type`. ms
// timestamps (startedAt/finishedAt/createdAt/expiresAt) and `attempt` are i64 to
// stay byte-stable vs fixtures. `outputs`/`input`/`output` are `unknown` →
// serde_json::Value; `outputs` is required (fixture shows null). `parentRunId`/
// `stepId`/`error`/`finishedAt`/`expiresAt`/`projectId` are required-nullable →
// Option WITHOUT skip. `banner?: string | null` is modeled as skip-when-absent
// Option<String> (fixtures show absent or string; the present-null case is not
// exercised and is not distinguished from absent). WorkflowRunSummary /
// WorkflowStepSummary derive PartialEq but not Eq (serde_json::Value is not Eq).
