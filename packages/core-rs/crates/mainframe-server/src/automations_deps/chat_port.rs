//! Narrow ChatManager seam for the agent port — fakeable in unit tests without
//! a full `ChatManagerDeps` graph.

use std::sync::Arc;

use mainframe_chat::chat_manager::ChatManager;
use mainframe_orchestration::last_assistant_text;
use mainframe_types::BoxFuture;
use mainframe_types::chat::NewChat;

pub trait AgentChatPort: Send + Sync {
    /// `create_chat_with_defaults` → the new chat id. `branch_name` rides the
    /// create so the chat row carries it from birth.
    /// `automation_run_id` stamps the chat as automation-created so the
    /// sessions sidebar hides it from the default list.
    #[allow(clippy::too_many_arguments)]
    fn create_chat<'a>(
        &'a self,
        project_id: &'a str,
        adapter_id: &'a str,
        model: Option<&'a str>,
        permission_mode: Option<&'a str>,
        branch_name: Option<&'a str>,
        automation_run_id: &'a str,
    ) -> BoxFuture<'a, String>;
    fn enable_worktree<'a>(
        &'a self,
        chat_id: &'a str,
        base_branch: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, Result<(), String>>;
    fn send_message<'a>(
        &'a self,
        chat_id: &'a str,
        content: &'a str,
    ) -> BoxFuture<'a, Result<(), String>>;
    /// The last assistant text block — the step's `result` output and the A2
    /// parse input (without the push notification length cap).
    fn last_assistant_text<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, String>;
    /// Best-effort session stop (run-cancel sweep).
    fn interrupt<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
}

pub struct ChatManagerPort {
    chats: Arc<ChatManager>,
}

impl ChatManagerPort {
    pub fn new(chats: Arc<ChatManager>) -> Self {
        Self { chats }
    }
}

impl AgentChatPort for ChatManagerPort {
    fn create_chat<'a>(
        &'a self,
        project_id: &'a str,
        adapter_id: &'a str,
        model: Option<&'a str>,
        permission_mode: Option<&'a str>,
        branch_name: Option<&'a str>,
        automation_run_id: &'a str,
    ) -> BoxFuture<'a, String> {
        Box::pin(async move {
            self.chats
                .create_chat_with_defaults(
                    NewChat {
                        project_id: project_id.to_string(),
                        adapter_id: adapter_id.to_string(),
                        model: model.map(str::to_string),
                        permission_mode: permission_mode.map(str::to_string),
                        automation_run_id: Some(automation_run_id.to_string()),
                        // An existing caller passing temporary=false:
                        // automation-created chats are already hidden from the
                        // default listing by `automation_run_id`.
                        temporary: false,
                        scratch_root: None,
                    },
                    None,
                    branch_name,
                )
                .await
                .id
        })
    }

    fn enable_worktree<'a>(
        &'a self,
        chat_id: &'a str,
        base_branch: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            self.chats
                .enable_worktree(chat_id, base_branch, branch_name)
                .await
                .map_err(|err| err.to_string())
        })
    }

    fn send_message<'a>(
        &'a self,
        chat_id: &'a str,
        content: &'a str,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            self.chats
                .send_message(chat_id, content, None, None)
                .await
                .map_err(|err| err.to_string())
        })
    }

    fn last_assistant_text<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, String> {
        Box::pin(async move { last_assistant_text(&self.chats.get_messages(chat_id).await) })
    }

    fn interrupt<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move { self.chats.interrupt_chat(chat_id).await })
    }
}
