//! Ported from `packages/core/src/chat/degraded-recovery.ts`.
//!
//! Degraded-chat recovery actions (missing transcript / missing worktree).
//!
//! Backs the daemon recovery routes and the degraded-chat UI card:
//! - `continue_here` — forget the dead CLI session so the next send spawns fresh
//!   in the same chat row (title/branch/worktree/project metadata carry over).
//! - `continue_in_project_root` — detach a chat from its deleted worktree and
//!   rebind it to the main checkout.
//! - `recreate_chat_worktree` — re-add the worktree at its stored path from the
//!   stored branch; fails clearly (409) when the branch is gone.

use std::sync::Arc;

use mainframe_adapter_api::{AdapterSession, BoxFuture};
use mainframe_services::workspace::{add_worktree_for_branch, branch_exists};
use mainframe_types::chat::Chat;

/// Errors surfaced by the recovery ops. The strings cross the wire (the routes
/// return them verbatim); `BranchGone` also carries the HTTP 409 the route emits.
#[derive(Debug, thiserror::Error)]
pub enum DegradedRecoveryError {
    #[error("Chat {0} not found")]
    ChatNotFound(String),
    #[error("Chat has no worktree")]
    NoWorktree,
    #[error("Chat has no worktree to recreate")]
    NoWorktreeToRecreate,
    #[error("Project {0} not found")]
    ProjectNotFound(String),
    #[error("Branch \"{0}\" no longer exists — continue in the project root instead")]
    BranchGone(String),
}

impl DegradedRecoveryError {
    /// `err.statusCode` — `recreateChatWorktree` tags the branch-gone case 409.
    pub fn status_code(&self) -> Option<u16> {
        match self {
            DegradedRecoveryError::BranchGone(_) => Some(409),
            _ => None,
        }
    }
}

/// Which in-memory fields `syncChatFields` clears for the active-chat cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoverySync {
    /// `{ claudeSessionId: undefined, sessionFilePath: undefined, transcriptMissing: false }`.
    ClearSession,
    /// `{ worktreePath: undefined, branchName: undefined }`.
    ClearWorktree,
}

/// The narrow surface the recovery ops need (TS `DegradedRecoveryDeps`). The
/// `git` seam is folded into `branch_exists`/`add_worktree` trait methods that
/// default to the real worktree ops; tests override them.
pub trait DegradedRecoveryDeps: Send + Sync {
    fn chats_get(&self, chat_id: &str) -> Option<Chat>;
    fn projects_get_path(&self, project_id: &str) -> Option<String>;
    /// `db.chats.clearSession` — NULL session id/file, transcript_missing=0.
    fn chats_clear_session(&self, chat_id: &str);
    /// `db.chats.clearWorktree` — NULL worktree_path/branch_name.
    fn chats_clear_worktree(&self, chat_id: &str);
    /// The active chat's live session, if any (`getActiveChat(id)?.session`).
    fn get_active_session(&self, chat_id: &str) -> Option<Arc<dyn AdapterSession>>;
    /// `active.session = null` after a kill.
    fn clear_active_session(&self, chat_id: &str);
    fn sync_chat_fields(&self, chat_id: &str, fields: RecoverySync);
    fn emit_chat_updated(&self, chat_id: &str);
    /// Drop the in-memory message + display caches (the history is gone for good).
    fn clear_messages(&self, chat_id: &str);

    /// `git.branchExists` — defaults to the real `rev-parse --verify` check.
    fn branch_exists<'a>(
        &'a self,
        project_path: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, bool> {
        Box::pin(async move { branch_exists(project_path, branch_name).await })
    }
    /// `git.addWorktree` — defaults to the real `worktree add` op.
    fn add_worktree<'a>(
        &'a self,
        project_path: &'a str,
        worktree_path: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let _ = add_worktree_for_branch(project_path, worktree_path, branch_name).await;
        })
    }
}

fn require_chat(
    deps: &dyn DegradedRecoveryDeps,
    chat_id: &str,
) -> Result<Chat, DegradedRecoveryError> {
    deps.chats_get(chat_id)
        .ok_or_else(|| DegradedRecoveryError::ChatNotFound(chat_id.to_string()))
}

/// Kill a spawned CLI session so the next send respawns with the recovered config.
async fn kill_spawned_session(deps: &dyn DegradedRecoveryDeps, chat_id: &str) {
    if let Some(session) = deps.get_active_session(chat_id)
        && session.is_spawned()
    {
        let _ = session.kill().await;
        deps.clear_active_session(chat_id);
    }
}

pub async fn continue_here(
    deps: &dyn DegradedRecoveryDeps,
    chat_id: &str,
) -> Result<(), DegradedRecoveryError> {
    require_chat(deps, chat_id)?;
    kill_spawned_session(deps, chat_id).await;
    deps.chats_clear_session(chat_id);
    deps.sync_chat_fields(chat_id, RecoverySync::ClearSession);
    deps.clear_messages(chat_id);
    deps.emit_chat_updated(chat_id);
    Ok(())
}

pub async fn continue_in_project_root(
    deps: &dyn DegradedRecoveryDeps,
    chat_id: &str,
) -> Result<(), DegradedRecoveryError> {
    let chat = require_chat(deps, chat_id)?;
    if chat.worktree_path.is_none() {
        return Err(DegradedRecoveryError::NoWorktree);
    }
    kill_spawned_session(deps, chat_id).await;
    deps.chats_clear_worktree(chat_id);
    deps.sync_chat_fields(chat_id, RecoverySync::ClearWorktree);
    deps.emit_chat_updated(chat_id);
    Ok(())
}

pub async fn recreate_chat_worktree(
    deps: &dyn DegradedRecoveryDeps,
    chat_id: &str,
) -> Result<(), DegradedRecoveryError> {
    let chat = require_chat(deps, chat_id)?;
    let (Some(worktree_path), Some(branch_name)) =
        (chat.worktree_path.clone(), chat.branch_name.clone())
    else {
        return Err(DegradedRecoveryError::NoWorktreeToRecreate);
    };
    let project_path = deps
        .projects_get_path(&chat.project_id)
        .ok_or_else(|| DegradedRecoveryError::ProjectNotFound(chat.project_id.clone()))?;

    if !deps.branch_exists(&project_path, &branch_name).await {
        return Err(DegradedRecoveryError::BranchGone(branch_name));
    }
    deps.add_worktree(&project_path, &worktree_path, &branch_name)
        .await;
    // enrichChat recomputes worktreeMissing from disk on read, so a plain re-emit clears the flag.
    deps.emit_chat_updated(chat_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{FakeSession, test_chat};
    use std::sync::Mutex as StdMutex;

    struct FakeDeps {
        chat: StdMutex<Option<Chat>>,
        project_path: Option<String>,
        session: Option<Arc<FakeSession>>,
        synced: StdMutex<Vec<(String, RecoverySync)>>,
        updated: StdMutex<Vec<String>>,
        cleared_messages: StdMutex<Vec<String>>,
        branch_exists: bool,
        add_worktree_calls: StdMutex<Vec<(String, String, String)>>,
    }
    impl Default for FakeDeps {
        fn default() -> Self {
            Self {
                chat: StdMutex::new(None),
                project_path: Some("/project/rec".to_string()),
                session: None,
                synced: StdMutex::new(Vec::new()),
                updated: StdMutex::new(Vec::new()),
                cleared_messages: StdMutex::new(Vec::new()),
                branch_exists: true,
                add_worktree_calls: StdMutex::new(Vec::new()),
            }
        }
    }
    impl DegradedRecoveryDeps for FakeDeps {
        fn chats_get(&self, _chat_id: &str) -> Option<Chat> {
            self.chat.lock().unwrap().clone()
        }
        fn projects_get_path(&self, _project_id: &str) -> Option<String> {
            self.project_path.clone()
        }
        fn chats_clear_session(&self, chat_id: &str) {
            if let Some(c) = self.chat.lock().unwrap().as_mut() {
                c.claude_session_id = None;
                c.session_file_path = None;
                c.transcript_missing = Some(false);
            }
            let _ = chat_id;
        }
        fn chats_clear_worktree(&self, _chat_id: &str) {
            if let Some(c) = self.chat.lock().unwrap().as_mut() {
                c.worktree_path = None;
                c.branch_name = None;
            }
        }
        fn get_active_session(&self, _chat_id: &str) -> Option<Arc<dyn AdapterSession>> {
            self.session.clone().map(|s| s as Arc<dyn AdapterSession>)
        }
        fn clear_active_session(&self, _chat_id: &str) {}
        fn sync_chat_fields(&self, chat_id: &str, fields: RecoverySync) {
            self.synced
                .lock()
                .unwrap()
                .push((chat_id.to_string(), fields));
        }
        fn emit_chat_updated(&self, chat_id: &str) {
            self.updated.lock().unwrap().push(chat_id.to_string());
        }
        fn clear_messages(&self, chat_id: &str) {
            self.cleared_messages
                .lock()
                .unwrap()
                .push(chat_id.to_string());
        }
        fn branch_exists<'a>(
            &'a self,
            _project_path: &'a str,
            _branch_name: &'a str,
        ) -> BoxFuture<'a, bool> {
            let v = self.branch_exists;
            Box::pin(async move { v })
        }
        fn add_worktree<'a>(
            &'a self,
            project_path: &'a str,
            worktree_path: &'a str,
            branch_name: &'a str,
        ) -> BoxFuture<'a, ()> {
            self.add_worktree_calls.lock().unwrap().push((
                project_path.to_string(),
                worktree_path.to_string(),
                branch_name.to_string(),
            ));
            Box::pin(async {})
        }
    }

    fn seed(deps: &FakeDeps, mutate: impl FnOnce(&mut Chat)) {
        let mut c = test_chat("chat-1");
        c.project_id = "p-rec".to_string();
        mutate(&mut c);
        *deps.chat.lock().unwrap() = Some(c);
    }

    #[tokio::test]
    async fn continue_here_clears_session_drops_messages_and_broadcasts() {
        let deps = FakeDeps::default();
        seed(&deps, |c| {
            c.claude_session_id = Some("dead-sess".to_string());
            c.session_file_path = Some("/x/dead-sess.jsonl".to_string());
            c.transcript_missing = Some(true);
        });

        continue_here(&deps, "chat-1").await.unwrap();

        let row = deps.chat.lock().unwrap().clone().unwrap();
        assert_eq!(row.claude_session_id, None);
        assert_eq!(row.session_file_path, None);
        assert_eq!(row.transcript_missing, Some(false));
        assert_eq!(deps.cleared_messages.lock().unwrap().as_slice(), ["chat-1"]);
        assert_eq!(deps.updated.lock().unwrap().as_slice(), ["chat-1"]);
        assert_eq!(
            deps.synced.lock().unwrap().as_slice(),
            [("chat-1".to_string(), RecoverySync::ClearSession)]
        );
    }

    #[tokio::test]
    async fn continue_here_kills_a_spawned_session() {
        let session = Arc::new(FakeSession::spawned());
        let deps = FakeDeps {
            session: Some(session.clone()),
            ..Default::default()
        };
        seed(&deps, |c| {
            c.claude_session_id = Some("dead-sess".to_string());
            c.transcript_missing = Some(true);
        });

        continue_here(&deps, "chat-1").await.unwrap();
        assert_eq!(session.kills(), 1);
    }

    #[tokio::test]
    async fn continue_here_rejects_unknown_chat() {
        let deps = FakeDeps::default();
        let err = continue_here(&deps, "nope").await.unwrap_err();
        assert!(err.to_string().to_lowercase().contains("not found"));
    }

    #[tokio::test]
    async fn continue_in_project_root_detaches_worktree_and_broadcasts() {
        let deps = FakeDeps::default();
        seed(&deps, |c| {
            c.worktree_path = Some("/project/rec/.worktrees/feat-x".to_string());
            c.branch_name = Some("feat-x".to_string());
        });

        continue_in_project_root(&deps, "chat-1").await.unwrap();

        let row = deps.chat.lock().unwrap().clone().unwrap();
        assert_eq!(row.worktree_path, None);
        assert_eq!(row.branch_name, None);
        assert_eq!(deps.updated.lock().unwrap().as_slice(), ["chat-1"]);
        assert_eq!(
            deps.synced.lock().unwrap().as_slice(),
            [("chat-1".to_string(), RecoverySync::ClearWorktree)]
        );
    }

    #[tokio::test]
    async fn continue_in_project_root_rejects_when_no_worktree() {
        let deps = FakeDeps::default();
        seed(&deps, |_c| {});
        let err = continue_in_project_root(&deps, "chat-1").await.unwrap_err();
        assert!(err.to_string().to_lowercase().contains("no worktree"));
    }

    #[tokio::test]
    async fn recreate_worktree_recreates_from_stored_branch_and_broadcasts() {
        let deps = FakeDeps::default();
        seed(&deps, |c| {
            c.worktree_path = Some("/project/rec/.worktrees/feat-x".to_string());
            c.branch_name = Some("feat-x".to_string());
        });

        recreate_chat_worktree(&deps, "chat-1").await.unwrap();

        assert_eq!(
            deps.add_worktree_calls.lock().unwrap().as_slice(),
            [(
                "/project/rec".to_string(),
                "/project/rec/.worktrees/feat-x".to_string(),
                "feat-x".to_string()
            )]
        );
        assert_eq!(deps.updated.lock().unwrap().as_slice(), ["chat-1"]);
    }

    #[tokio::test]
    async fn recreate_worktree_fails_409_when_branch_gone() {
        let deps = FakeDeps {
            branch_exists: false,
            ..Default::default()
        };
        seed(&deps, |c| {
            c.worktree_path = Some("/project/rec/.worktrees/feat-x".to_string());
            c.branch_name = Some("feat-x".to_string());
        });

        let err = recreate_chat_worktree(&deps, "chat-1").await.unwrap_err();
        assert!(
            err.to_string()
                .to_lowercase()
                .contains("branch \"feat-x\" no longer exists")
        );
        assert_eq!(err.status_code(), Some(409));
        assert!(deps.add_worktree_calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn recreate_worktree_rejects_when_no_stored_worktree_branch() {
        let deps = FakeDeps::default();
        seed(&deps, |_c| {});
        let err = recreate_chat_worktree(&deps, "chat-1").await.unwrap_err();
        assert!(err.to_string().to_lowercase().contains("no worktree"));
    }
}

// PORT STATUS: src/chat/degraded-recovery.ts (85 lines) — NEW module (#424)
// confidence: high
// todos: 0
// notes: continueHere / continueInProjectRoot / recreateChatWorktree ported. The
// notes: injectable `git` (`DegradedRecoveryGit`) folds into default `branch_exists`/
// notes: `add_worktree` trait methods (real `mainframe_services::workspace` ops);
// notes: tests override them. The 409 `Object.assign(err,{statusCode})` → a
// notes: `BranchGone` error variant with `status_code() == Some(409)`. syncChatFields'
// notes: cleared-field partial → a `RecoverySync` enum (internal, not wire). degraded-
// notes: recovery.test.ts ported ×9 against an in-crate `DegradedRecoveryDeps` fake.
