//! `test_chat` split out of `test_support.rs` (kept under the 300-line cap when
//! the history-cache test fields landed in `FakeSession`) — re-exported from
//! there so every existing `crate::test_support::test_chat` call site keeps
//! working unchanged.

use mainframe_types::chat::{Chat, ChatStatus};
use mainframe_types::settings::ExecutionMode;

/// A minimal `Chat` for tests that only care about a few fields.
pub fn test_chat(id: &str) -> Chat {
    Chat {
        id: id.to_string(),
        adapter_id: "claude".to_string(),
        project_id: "p1".to_string(),
        title: None,
        claude_session_id: None,
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
        effort: None,
        fast: None,
        ultracode: None,
        adaptive_thinking: None,
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
    }
}

// Not a port; test scaffolding only. No PORT STATUS trailer.
