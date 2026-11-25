//! In-memory `OrchestrationPort` for the tool tests.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use mainframe_types::chat::ChatMessage;
use mainframe_types::events::DaemonEvent;
use mainframe_types::sync::LockExt as _;
use tokio::sync::broadcast;

use crate::errors::{ErrorCode, PortError, ToolError};
use crate::ports::{
    AdapterView, BoxFuture, ChatView, LaunchRequest, LaunchWorkspace, ModelView, OrchestrationPort,
};
use crate::test_support::{chat_view, wire_chat};

#[derive(Default)]
pub struct FakeState {
    pub chats: HashMap<String, ChatView>,
    pub messages: HashMap<String, Vec<ChatMessage>>,
    pub adapters: Vec<AdapterView>,
    pub projects: HashSet<String>,
    pub sent: Vec<(String, String)>,
    pub steered: Vec<(String, String)>,
    pub interrupted: Vec<String>,
    pub launched: Vec<LaunchRequest>,
    pub send_marks_working: bool,
    /// `send` fails for these chats (their CLI does not start).
    pub send_fails: HashSet<String>,
    /// Every failed `send`.
    pub failed_sends: usize,
    /// Every retired chat, and whether its worktree went with it.
    pub retired: Vec<(String, bool)>,
    /// `chat` fails while set, as on a locked or broken database.
    pub chat_reads_fail: bool,
    /// Every `chat_changed` call, in order.
    pub changed: Vec<String>,
    /// `chat_changed` also emits `chat.updated`, as the daemon does.
    pub announce_changes: bool,
    /// Called synchronously right after `launch_chat` creates the chat, and
    /// before it returns. Lets a test land a state change (a Stop) exactly
    /// between "the child exists" and "the task is inserted" deterministically:
    /// `FakePort`'s other async methods complete without yielding, so there
    /// is no real race to win there otherwise.
    pub after_launch: Option<Arc<dyn Fn() + Send + Sync>>,
    /// Called at the start of every `interrupt`.
    pub before_interrupt: Option<Arc<dyn Fn() + Send + Sync>>,
    /// Awaited at the start of every `send`.
    pub before_send: Option<Arc<dyn Fn() -> BoxFuture<'static, ()> + Send + Sync>>,
}

#[derive(Clone)]
pub struct FakePort {
    pub state: Arc<Mutex<FakeState>>,
    tx: broadcast::Sender<DaemonEvent>,
}

impl FakePort {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(64);
        let state = FakeState {
            adapters: vec![AdapterView {
                id: "claude".into(),
                name: "Claude".into(),
                installed: true,
                available: true,
                unavailable_reason: None,
                models: vec![ModelView {
                    id: "default".into(),
                    label: "Default".into(),
                }],
                steer: true,
                auto_mode: true,
            }],
            projects: HashSet::from(["p".to_string()]),
            send_marks_working: true,
            ..FakeState::default()
        };
        Self {
            state: Arc::new(Mutex::new(state)),
            tx,
        }
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, FakeState> {
        self.state.lock_recover()
    }

    /// Inserts a default chat and returns a copy to tweak and `put` back.
    pub(crate) fn add_chat(&self, id: &str) -> ChatView {
        let chat = chat_view(id);
        self.lock().chats.insert(id.into(), chat.clone());
        chat
    }

    pub fn put(&self, chat: ChatView) {
        self.lock().chats.insert(chat.id.clone(), chat);
    }

    /// Simulates a discard: the row is gone before `ChatEnded` is emitted
    /// (`chat_manager/discard.rs::discard_chat`).
    pub fn remove(&self, id: &str) {
        self.lock().chats.remove(id);
    }

    pub fn update(&self, id: &str, f: impl FnOnce(&mut ChatView)) {
        if let Some(chat) = self.lock().chats.get_mut(id) {
            f(chat);
        }
    }

    /// How many event streams are open.
    pub fn subscribers(&self) -> usize {
        self.tx.receiver_count()
    }

    /// Emits a `chat.updated` so waiters and the flush loop re-read.
    pub fn touch(&self, id: &str) {
        let _ = self.tx.send(DaemonEvent::ChatUpdated {
            chat: wire_chat(id),
            reason: None,
        });
    }
}

impl OrchestrationPort for FakePort {
    fn chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Result<Option<ChatView>, PortError>> {
        Box::pin(async move {
            let state = self.lock();
            if state.chat_reads_fail {
                return Err(PortError::Internal("database is locked".into()));
            }
            Ok(state.chats.get(chat_id).cloned())
        })
    }

    fn list_chats<'a>(
        &'a self,
        project_id: &'a str,
        _archived: bool,
    ) -> BoxFuture<'a, Result<Vec<ChatView>, PortError>> {
        Box::pin(async move {
            let state = self.lock();
            Ok(state
                .chats
                .values()
                .filter(|c| c.project_id == project_id)
                .cloned()
                .collect())
        })
    }

    fn project_exists<'a>(&'a self, project_id: &'a str) -> BoxFuture<'a, bool> {
        Box::pin(async move { self.lock().projects.contains(project_id) })
    }

    fn messages<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Vec<ChatMessage>> {
        Box::pin(async move {
            self.lock()
                .messages
                .get(chat_id)
                .cloned()
                .unwrap_or_default()
        })
    }

    fn adapters(&self) -> BoxFuture<'_, Vec<AdapterView>> {
        Box::pin(async move { self.lock().adapters.clone() })
    }

    fn launch_chat(&self, request: LaunchRequest) -> BoxFuture<'_, Result<ChatView, PortError>> {
        Box::pin(async move {
            if let LaunchWorkspace::ExistingWorktree { worktree_path } = &request.workspace
                && worktree_path.contains("bad")
            {
                return Err(ToolError::new(ErrorCode::WorkspaceInvalid, "not a worktree").into());
            }
            // A deliberate scheduling point: on a cooperative (even
            // single-threaded) executor, concurrent `delegate_task` calls
            // that raced past their own checks before either reached this
            // point would now interleave here, widening the check-then-
            // insert race a correct caller must close with its own lock.
            tokio::task::yield_now().await;
            let mut state = self.lock();
            let id = format!("launched{}", state.launched.len() + 1);
            let mut chat = chat_view(&id);
            chat.project_id = request.project_id.clone();
            chat.adapter_id = request.adapter_id.clone();
            chat.model = request.model.clone();
            chat.permission_mode = request.permission_mode;
            chat.plan_mode = request.plan_mode;
            chat.title = request.title.clone();
            chat.created_by_chat_id = Some(request.created_by_chat_id.clone());
            chat.parent_chat_id = request.parent_chat_id.clone();
            state.chats.insert(id, chat.clone());
            state.launched.push(request);
            let hook = state.after_launch.clone();
            drop(state);
            if let Some(hook) = hook {
                hook();
            }
            Ok(chat)
        })
    }

    fn send<'a>(&'a self, chat_id: &'a str, text: &'a str) -> BoxFuture<'a, Result<(), PortError>> {
        Box::pin(async move {
            let hook = self.lock().before_send.clone();
            if let Some(hook) = hook {
                hook().await;
            }
            let mut state = self.lock();
            if state.send_fails.contains(chat_id) {
                state.failed_sends += 1;
                return Err(PortError::Internal("spawn failed".into()));
            }
            state.sent.push((chat_id.into(), text.into()));
            if state.send_marks_working
                && let Some(chat) = state.chats.get_mut(chat_id)
            {
                chat.working = true;
            }
            Ok(())
        })
    }

    fn retire_chat<'a>(&'a self, chat_id: &'a str, delete_worktree: bool) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let retired = (chat_id.to_string(), delete_worktree);
            self.lock().retired.push(retired);
        })
    }

    fn steer<'a>(
        &'a self,
        chat_id: &'a str,
        text: &'a str,
    ) -> BoxFuture<'a, Result<(), PortError>> {
        Box::pin(async move {
            self.lock().steered.push((chat_id.into(), text.into()));
            Ok(())
        })
    }

    fn interrupt<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let hook = self.lock().before_interrupt.clone();
            if let Some(hook) = hook {
                hook();
            }
            let mut state = self.lock();
            state.interrupted.push(chat_id.into());
            if let Some(chat) = state.chats.get_mut(chat_id) {
                chat.working = false;
            }
        })
    }

    fn subscribe(&self) -> broadcast::Receiver<DaemonEvent> {
        self.tx.subscribe()
    }

    fn emit(&self, event: DaemonEvent) {
        let _ = self.tx.send(event);
    }

    fn chat_changed(&self, chat_id: &str) {
        let mut state = self.lock();
        state.changed.push(chat_id.to_string());
        if state.announce_changes {
            drop(state);
            self.touch(chat_id);
        }
    }
}
