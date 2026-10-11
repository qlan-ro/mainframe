//! `test_chat` is re-exported from `test_support.rs` so callers can use
//! `crate::test_support::test_chat`.

use mainframe_types::chat::{Chat, ChatStatus};
use mainframe_types::settings::ExecutionMode;

/// A minimal `Chat` for tests that only care about a few fields.
fn fixture_chat(id: &str) -> Chat {
    Chat {
        id: id.to_string(),
        adapter_id: "claude".to_string(),
        project_id: "p1".to_string(),
        title: None,
        vendor_session_id: None,
        session_file_path: None,
        model: Some("old-model".to_string()),
        permission_mode: Some(ExecutionMode::Default),
        plan_mode: None,
        status: ChatStatus::Active,
        created_at: String::new(),
        updated_at: String::new(),
        total_cost: 0.0,
        total_tokens_input: 0,
        total_tokens_output: 0,
        last_context_tokens_input: 0,
        context_files: None,
        mentions: None,
        modified_files: None,
        worktree_path: None,
        branch_name: None,
        process_state: None,
        last_context_total_tokens: None,
        last_context_max_tokens: None,
        display_status: None,
        is_running: None,
        background_activity: None,
        worktree_missing: None,
        directory_missing: None,
        missing_directory_path: None,
        transcript_missing: None,
        todos: None,
        pinned: None,
        tuning: mainframe_types::chat::SessionTuning {
            effort: None,
            fast: None,
            ultracode: None,
            adaptive_thinking: None,
        },
        detected_prs: None,
        tags: None,
        automation_run_id: None,
        temporary: false,
        no_project: false,
        context_lost_at: None,
        vendor_session_ephemeral: false,
        scratch_path: None,
        parent_chat_id: None,
        side_chat_id: None,
        side_chat_waiting: None,
        orchestration: Default::default(),
    }
}

pub struct ChatBuilder(Chat);

impl ChatBuilder {
    pub fn new(id: &str) -> Self {
        Self(fixture_chat(id))
    }
    pub fn status(mut self, status: ChatStatus) -> Self {
        self.0.status = status;
        self
    }
    pub fn worktree(mut self, path: Option<&str>) -> Self {
        self.0.worktree_path = path.map(str::to_string);
        self
    }
    pub fn title(mut self, title: &str) -> Self {
        self.0.title = Some(title.into());
        self
    }
    pub fn vendor_session(mut self, id: &str) -> Self {
        self.0.vendor_session_id = Some(id.into());
        self
    }
    pub fn build(self) -> Chat {
        self.0
    }
}

pub fn test_chat(id: &str) -> Chat {
    ChatBuilder::new(id).build()
}
