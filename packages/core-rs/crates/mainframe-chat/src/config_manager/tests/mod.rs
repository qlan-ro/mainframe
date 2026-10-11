use super::*;
use crate::test_support::{FakeSession, test_chat};
use mainframe_types::chat::Chat;
use mainframe_types::settings_kv::MemorySettings;
use std::sync::atomic::{AtomicUsize, Ordering};

struct FakeDeps {
    cell: Arc<Mutex<ActiveChat>>,
    updates: Mutex<Vec<ChatPatch>>,
    events: Mutex<Vec<DaemonEvent>>,
    apply_tuning_calls: AtomicUsize,
    project: Option<Project>,
    start_chat_calls: AtomicUsize,
    stop_chat_calls: AtomicUsize,
    stop_launch_calls: Mutex<Vec<(String, String)>>,
    binding_changed: Mutex<Vec<Option<String>>>,
    move_files_error: Option<String>,
    settings: MemorySettings,
    owned: Vec<OwnedNativeSession>,
}

impl FakeDeps {
    fn new(cell: Arc<Mutex<ActiveChat>>) -> Self {
        Self {
            cell,
            updates: Mutex::new(Vec::new()),
            events: Mutex::new(Vec::new()),
            apply_tuning_calls: AtomicUsize::new(0),
            project: None,
            start_chat_calls: AtomicUsize::new(0),
            stop_chat_calls: AtomicUsize::new(0),
            stop_launch_calls: Mutex::new(Vec::new()),
            binding_changed: Mutex::new(Vec::new()),
            move_files_error: None,
            settings: MemorySettings::default(),
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
            move_files_error: Some(error.to_string()),
            ..Self::with_project(cell, project)
        }
    }
}

impl ConfigManagerDeps for FakeDeps {
    fn owned_native_sessions(&self, _: &str) -> Vec<OwnedNativeSession> {
        self.owned.clone()
    }

    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        Some(self.cell.clone())
    }
    fn chats_update(&self, _chat_id: &str, updates: &ChatPatch) {
        self.updates.lock().unwrap().push(updates.clone());
    }
    fn projects_get(&self, _project_id: &str) -> Option<Project> {
        self.project.clone()
    }
    fn settings(&self) -> &dyn SettingsKv {
        &self.settings
    }
    fn emit_event(&self, event: DaemonEvent) {
        self.events.lock().unwrap().push(event);
    }
    fn start_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        self.start_chat_calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {})
    }
    fn stop_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        self.stop_chat_calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {})
    }
    fn apply_tuning<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        self.apply_tuning_calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {})
    }
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        project_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        self.stop_launch_calls
            .lock()
            .unwrap()
            .push((project_id.to_string(), project_path.to_string()));
        Some(Box::pin(async {}))
    }
    fn take_starting_chat<'a>(&'a self, _chat_id: &'a str) -> Option<BoxFuture<'a, ()>> {
        None
    }
    fn on_binding_changed(&self, _chat_id: &str, worktree_path: Option<&str>) {
        self.binding_changed
            .lock()
            .unwrap()
            .push(worktree_path.map(|s| s.to_string()));
    }
    fn move_claude_session_files<'a>(
        &'a self,
        _session_id: &'a str,
        _old_dir: &'a str,
        _new_dir: &'a str,
    ) -> BoxFuture<'a, Result<(), SessionFilesError>> {
        Box::pin(async move {
            match &self.move_files_error {
                Some(err) => Err(std::io::Error::other(err.clone()).into()),
                None => Ok(()),
            }
        })
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
