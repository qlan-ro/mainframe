use super::*;
use mainframe_types::sync::LockExt as _;
impl ChatShared {
    /// Follow a transcript the CLI just moved (the agent entered or left a
    /// worktree), off the sink's thread.
    pub(crate) fn spawn_transcript_refresh(self: &Arc<Self>, chat_id: &str) {
        let Some(cell) = self.active(chat_id) else {
            return;
        };
        let mut chat = cell.lock_recover().chat.clone();
        let shared = self.clone();
        tokio::spawn(async move {
            crate::transcript_presence::refresh_transcript_location(&shared, &mut chat).await;
        });
    }
}

impl ChatShared {
    pub(crate) async fn sweep_transcript_presence(&self, project_id: &str) {
        for mut chat in self.deps.chats_list(project_id) {
            if chat.status != mainframe_types::chat::ChatStatus::Archived
                && chat.claude_session_id.is_some()
            {
                crate::transcript_presence::reconcile_transcript_presence(self, &mut chat).await;
            }
        }
    }
}
