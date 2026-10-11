use super::*;
use crate::config_transcripts::OwnedNativeSession;
use crate::test_support::{FakeSession, test_chat};
use mainframe_types::chat::Chat;
use mainframe_types::chat::Project;

struct Setup {
    cell: Arc<Mutex<ActiveChat>>,
    project: Option<Project>,
    move_files_error: Option<String>,
    owned: Vec<OwnedNativeSession>,
}
impl Setup {
    fn new(cell: Arc<Mutex<ActiveChat>>) -> Self {
        Self {
            cell,
            project: None,
            move_files_error: None,
            owned: Vec::new(),
        }
    }
    fn with_project(cell: Arc<Mutex<ActiveChat>>, project: Project) -> Self {
        Self {
            project: Some(project),
            ..Self::new(cell)
        }
    }
    fn failing_move(cell: Arc<Mutex<ActiveChat>>, project: Project, error: &str) -> Self {
        Self {
            move_files_error: Some(error.into()),
            ..Self::with_project(cell, project)
        }
    }
}

struct Harness {
    config: ChatConfigManager,
    deps: Arc<crate::test_support::FakeDeps>,
}
impl std::ops::Deref for Harness {
    type Target = ChatConfigManager;
    fn deref(&self) -> &Self::Target {
        &self.config
    }
}
impl Harness {
    fn new(setup: Setup) -> Self {
        let chat = setup.cell.lock().unwrap().chat.clone();
        let deps = crate::test_support::FakeDeps::with_chats(vec![chat.clone()]);
        deps.set_project_path(
            setup
                .project
                .as_ref()
                .map(|p| p.path.as_str())
                .unwrap_or("/tmp"),
        );
        deps.set_spawn_ok(true);
        *deps.workspace.has_launches.lock().unwrap() = true;
        *deps.store.owned_sessions.lock().unwrap() = setup.owned;
        *deps.workspace.move_files_error.lock().unwrap() = setup.move_files_error;
        let shared = crate::chat_manager::ChatShared::new(deps.clone());
        shared.active_chats.insert(chat.id, setup.cell);
        let offers = Arc::new(crate::worktree_offer::WorktreeOfferRegistry::new(
            shared.clone(),
        ));
        let events = Arc::new(crate::event_handler::EventHandler::new(
            shared.clone(),
            offers.clone(),
        ));
        let lifecycle = Arc::new(crate::lifecycle_manager::ChatLifecycleManager::new(
            shared.clone(),
            events,
            offers.clone(),
        ));
        Self {
            config: ChatConfigManager::new(shared, lifecycle, offers),
            deps,
        }
    }
    fn updates(&self) -> Vec<ChatPatch> {
        self.deps
            .store
            .updates
            .lock()
            .unwrap()
            .iter()
            .map(|(_, p)| p.clone())
            .filter(|p| {
                p.model.is_some()
                    || p.permission_mode.is_some()
                    || p.plan_mode.is_some()
                    || p.adapter_id.is_some()
                    || p.worktree_path.is_some()
            })
            .collect()
    }
    fn starts(&self) -> usize {
        self.deps.created_sessions().len()
    }

    fn bindings(&self) -> Vec<Option<String>> {
        self.updates()
            .into_iter()
            .filter_map(|p| p.worktree_path)
            .collect()
    }
}

fn cell_with(session: Arc<FakeSession>) -> Arc<Mutex<ActiveChat>> {
    Arc::new(Mutex::new(ActiveChat::new(test_chat("c1"), Some(session))))
}

fn worktreed_chat() -> Chat {
    let mut chat = test_chat("c1");
    chat.adapter_id = "codex".to_string();
    chat.claude_session_id = Some("sess1".to_string());
    chat.worktree_path = Some("/old/wt".to_string());
    chat.branch_name = Some("old-branch".to_string());
    chat
}

fn cell_with_chat(chat: Chat, session: Arc<FakeSession>) -> Arc<Mutex<ActiveChat>> {
    Arc::new(Mutex::new(ActiveChat::new(chat, Some(session))))
}

fn test_project() -> Project {
    Project {
        id: "p1".to_string(),
        name: "proj".to_string(),
        path: "/proj".to_string(),
        created_at: String::new(),
        last_opened_at: String::new(),
        parent_project_id: None,
        available: None,
    }
}

fn claude_worktreed_chat() -> Chat {
    let mut chat = worktreed_chat();
    chat.adapter_id = "claude".to_string();
    chat
}
fn git_project() -> (tempfile::TempDir, Project) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap().to_string();
    for args in [
        &["init", "-q"][..],
        &["config", "user.email", "t@t.dev"],
        &["config", "user.name", "Tester"],
        &["config", "commit.gpgsign", "false"],
        &["commit", "-q", "--allow-empty", "-m", "init"],
    ] {
        let status = std::process::Command::new("git")
            .args(args)
            .current_dir(&path)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?} failed");
    }
    let project = Project {
        path,
        ..test_project()
    };
    (dir, project)
}

fn claude_live_chat() -> Chat {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess1".to_string());
    chat
}

fn assert_created_worktree(repo: &tempfile::TempDir) {
    assert!(repo.path().join(".worktrees/feat-x/.git").is_file());
    assert!(
        std::process::Command::new("git")
            .args(["show-ref", "--verify", "--quiet", "refs/heads/feat/x"])
            .current_dir(repo.path())
            .status()
            .unwrap()
            .success()
    );
}

mod config;

mod worktree;

mod storage_failures;
