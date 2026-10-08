//! In-memory `OrchestrationPort` for the tool tests.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use mainframe_types::chat::{Chat, ChatMessage, ChatStatus};
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings::ExecutionMode;
use serde_json::json;
use tokio::sync::broadcast;

use crate::errors::{ErrorCode, PortError, ToolError};
use crate::ports::{
    AdapterView, BoxFuture, ChatView, LaunchRequest, LaunchWorkspace, ModelView, OrchestrationPort,
};
use crate::service::{CallCtx, OrchestrationService};
use crate::test_tasks::FakeTasks;

pub fn chat_view(id: &str) -> ChatView {
    ChatView {
        id: id.into(),
        project_id: "p".into(),
        title: Some(format!("Chat {id}")),
        adapter_id: "claude".into(),
        model: Some("default".into()),
        permission_mode: ExecutionMode::Default,
        plan_mode: false,
        status: ChatStatus::Active,
        working: false,
        pending_permission: None,
        temporary: false,
        automation: false,
        parent_chat_id: None,
        created_by_chat_id: None,
        task_id: None,
        worktree_path: None,
        branch_name: None,
        created_at: "2026-10-06T00:00:00.000Z".into(),
        updated_at: "2026-10-06T00:00:00.000Z".into(),
    }
}

/// A minimal wire `Chat` for `chat.updated` events in tests.
pub fn wire_chat(id: &str) -> Chat {
    let value = json!({
        "id": id, "adapterId": "claude", "projectId": "p", "status": "active",
        "createdAt": "", "updatedAt": "", "totalCost": 0.0,
        "totalTokensInput": 0, "totalTokensOutput": 0, "lastContextTokensInput": 0
    });
    serde_json::from_value(value).unwrap_or_else(|e| panic!("wire chat: {e}"))
}

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
    /// Every `chat_changed` call, in order.
    pub changed: Vec<String>,
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
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Inserts a default chat and returns a copy to tweak and `put` back.
    pub fn add_chat(&self, id: &str) -> ChatView {
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

    /// Emits a `chat.updated` so waiters and the flush loop re-read.
    pub fn touch(&self, id: &str) {
        let _ = self.tx.send(DaemonEvent::ChatUpdated {
            chat: wire_chat(id),
            reason: None,
        });
    }
}

impl OrchestrationPort for FakePort {
    fn chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Option<ChatView>> {
        Box::pin(async move { self.lock().chats.get(chat_id).cloned() })
    }

    fn list_chats<'a>(
        &'a self,
        project_id: &'a str,
        _archived: bool,
    ) -> BoxFuture<'a, Vec<ChatView>> {
        Box::pin(async move {
            let state = self.lock();
            state
                .chats
                .values()
                .filter(|c| c.project_id == project_id)
                .cloned()
                .collect()
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
            Ok(chat)
        })
    }

    fn send<'a>(&'a self, chat_id: &'a str, text: &'a str) -> BoxFuture<'a, Result<(), PortError>> {
        Box::pin(async move {
            let mut state = self.lock();
            state.sent.push((chat_id.into(), text.into()));
            if state.send_marks_working
                && let Some(chat) = state.chats.get_mut(chat_id)
            {
                chat.working = true;
            }
            Ok(())
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
        self.lock().changed.push(chat_id.to_string());
    }
}

/// A service over `port` and a live call context for `caller_chat_id`.
pub fn service_with(port: FakePort, caller_chat_id: &str) -> (Arc<OrchestrationService>, CallCtx) {
    service_with_tasks(port, FakeTasks::default(), caller_chat_id)
}

pub fn service_with_tasks(
    port: FakePort,
    tasks: FakeTasks,
    caller_chat_id: &str,
) -> (Arc<OrchestrationService>, CallCtx) {
    let svc = Arc::new(OrchestrationService::new(
        Arc::new(port),
        Arc::new(tasks),
        "test",
        1,
    ));
    let ctx = call_ctx(&svc, caller_chat_id);
    (svc, ctx)
}

/// A live call context for another chat on the same service.
pub fn call_ctx(svc: &OrchestrationService, chat_id: &str) -> CallCtx {
    let token = svc
        .issue_launch(chat_id, &format!("session-{chat_id}"))
        .token;
    let caller = svc
        .credentials()
        .resolve(token.expose())
        .unwrap_or_else(|| panic!("caller"));
    svc.begin_call(&caller, "n:1")
}
