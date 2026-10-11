use super::*;
use crate::chat_manager::ChatStore as _;
use crate::test_support::{FakeDeps, FakeSession, test_chat};
use crate::types::ActiveChat;
use crate::worktree_offer::WorktreeOfferRegistry;
use std::sync::{Arc, Mutex};

struct Harness {
    deps: Arc<FakeDeps>,
    shared: Arc<ChatShared>,
    handler: EventHandler,
    session: Option<Arc<FakeSession>>,
}
impl Default for Harness {
    fn default() -> Self {
        let deps = FakeDeps::arc();
        deps.set_project_path("/project/rec");
        let shared = ChatShared::new(deps.clone());
        let handler = EventHandler::new(
            shared.clone(),
            Arc::new(WorktreeOfferRegistry::new(shared.clone())),
        );
        Self {
            deps,
            shared,
            handler,
            session: None,
        }
    }
}

fn seed(deps: &Harness, mutate: impl FnOnce(&mut Chat)) {
    let mut c = test_chat("chat-1");
    c.project_id = "p-rec".to_string();
    mutate(&mut c);
    deps.deps.store.insert(c.clone());
    deps.shared.active_chats.insert(
        c.id.clone(),
        Arc::new(Mutex::new(ActiveChat::new(
            c,
            deps.session
                .clone()
                .map(|s| s as Arc<dyn mainframe_adapter_api::AdapterSession>),
        ))),
    );
}

#[tokio::test]
async fn continue_here_clears_session_drops_messages_and_broadcasts() {
    let deps = Harness::default();
    seed(&deps, |c| {
        c.claude_session_id = Some("dead-sess".to_string());
        c.session_file_path = Some("/x/dead-sess.jsonl".to_string());
        c.transcript_missing = Some(true);
    });

    continue_here(&deps.shared, &deps.handler, "chat-1")
        .await
        .unwrap();

    let row = deps.deps.chats_get("chat-1").unwrap().unwrap();
    assert_eq!(row.claude_session_id, None);
    assert_eq!(row.session_file_path, None);
    assert_eq!(row.transcript_missing, Some(false));
    assert_eq!(deps.shared.messages.lock().unwrap().get("chat-1"), None);
    assert_eq!(deps.deps.events().len(), 1);
    let active = deps.shared.active("chat-1").unwrap();
    assert_eq!(active.lock().unwrap().chat.claude_session_id, None);
}

#[tokio::test]
async fn continue_here_kills_a_spawned_session() {
    let session = Arc::new(FakeSession::spawned());
    let deps = Harness {
        session: Some(session.clone()),
        ..Default::default()
    };
    seed(&deps, |c| {
        c.claude_session_id = Some("dead-sess".to_string());
        c.transcript_missing = Some(true);
    });

    continue_here(&deps.shared, &deps.handler, "chat-1")
        .await
        .unwrap();
    assert_eq!(session.kills(), 1);
}

#[tokio::test]
async fn continue_here_rejects_unknown_chat() {
    let deps = Harness::default();
    let err = continue_here(&deps.shared, &deps.handler, "nope")
        .await
        .unwrap_err();
    assert!(err.to_string().to_lowercase().contains("not found"));
}

#[tokio::test]
async fn continue_in_project_root_detaches_worktree_and_broadcasts() {
    let deps = Harness::default();
    seed(&deps, |c| {
        c.worktree_path = Some("/project/rec/.worktrees/feat-x".to_string());
        c.branch_name = Some("feat-x".to_string());
    });

    continue_in_project_root(&deps.shared, "chat-1")
        .await
        .unwrap();

    let row = deps.deps.chats_get("chat-1").unwrap().unwrap();
    assert_eq!(row.worktree_path, None);
    assert_eq!(row.branch_name, None);
    assert_eq!(deps.deps.events().len(), 1);
    let active = deps.shared.active("chat-1").unwrap();
    assert_eq!(active.lock().unwrap().chat.worktree_path, None);
}

#[tokio::test]
async fn continue_in_project_root_rejects_when_no_worktree() {
    let deps = Harness::default();
    seed(&deps, |_c| {});
    let err = continue_in_project_root(&deps.shared, "chat-1")
        .await
        .unwrap_err();
    assert!(err.to_string().to_lowercase().contains("no worktree"));
}

#[tokio::test]
async fn recreate_worktree_recreates_from_stored_branch_and_broadcasts() {
    let deps = Harness::default();
    seed(&deps, |c| {
        c.worktree_path = Some("/project/rec/.worktrees/feat-x".to_string());
        c.branch_name = Some("feat-x".to_string());
    });

    recreate_chat_worktree(&deps.shared, "chat-1")
        .await
        .unwrap();

    assert_eq!(
        deps.deps
            .workspace
            .added_worktrees
            .lock()
            .unwrap()
            .as_slice(),
        [(
            "/project/rec".to_string(),
            "/project/rec/.worktrees/feat-x".to_string(),
            "feat-x".to_string()
        )]
    );
    assert_eq!(deps.deps.events().len(), 1);
}

#[tokio::test]
async fn recreate_worktree_fails_409_when_branch_gone() {
    let deps = Harness::default();
    *deps.deps.workspace.branch_missing.lock().unwrap() = true;
    seed(&deps, |c| {
        c.worktree_path = Some("/project/rec/.worktrees/feat-x".to_string());
        c.branch_name = Some("feat-x".to_string());
    });

    let err = recreate_chat_worktree(&deps.shared, "chat-1")
        .await
        .unwrap_err();
    assert!(
        err.to_string()
            .to_lowercase()
            .contains("branch \"feat-x\" no longer exists")
    );
    assert_eq!(err.status_kind(), StatusKind::Conflict);
    assert!(
        deps.deps
            .workspace
            .added_worktrees
            .lock()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn recreate_worktree_rejects_when_no_stored_worktree_branch() {
    let deps = Harness::default();
    seed(&deps, |_c| {});
    let err = recreate_chat_worktree(&deps.shared, "chat-1")
        .await
        .unwrap_err();
    assert!(err.to_string().to_lowercase().contains("no worktree"));
}
