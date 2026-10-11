use mainframe_types::claude_workflow::{ClaudeWorkflowRun, ClaudeWorkflowRunStatus};

pub trait WorkflowSink: Send + Sync {
    fn seed(&self, chat_id: &str, task_id: &str, name: Option<String>);
    fn apply_record(&self, chat_id: &str, run: ClaudeWorkflowRun);
    fn stamp_status(&self, chat_id: &str, task_id: &str, status: ClaudeWorkflowRunStatus);
}
