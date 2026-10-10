//! The seams this crate reaches the rest of the daemon through. The server
//! implements them over `ChatManager`, the DB, git, and the event broadcast
//! (`mainframe-server/src/orchestration_deps/`); tests use in-memory fakes.

use std::future::Future;
use std::pin::Pin;

use mainframe_types::chat::{ChatMessage, ChatStatus};
use mainframe_types::events::DaemonEvent;
use mainframe_types::orchestration::DelegatedTask;
use mainframe_types::settings::ExecutionMode;
use tokio::sync::broadcast;

use crate::errors::PortError;
use crate::policy::Privileges;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// A pending permission or question gate, as `chat_wait` reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingPermissionView {
    pub tool_name: String,
    pub summary: String,
}

/// The adapter-neutral facts the tools need about one chat.
#[derive(Debug, Clone, PartialEq)]
pub struct ChatView {
    pub id: String,
    pub project_id: String,
    pub title: Option<String>,
    pub adapter_id: String,
    pub model: Option<String>,
    pub permission_mode: ExecutionMode,
    pub plan_mode: bool,
    pub status: ChatStatus,
    /// The CLI is mid-turn, or holds CLI-queued prompts.
    pub working: bool,
    pub pending_permission: Option<PendingPermissionView>,
    pub temporary: bool,
    /// Created by an automation run; such chats are not agent-addressable.
    pub automation: bool,
    pub parent_chat_id: Option<String>,
    pub created_by_chat_id: Option<String>,
    /// The delegated task this chat runs, when it is a delegated child.
    pub task_id: Option<String>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl ChatView {
    #[must_use]
    pub(crate) fn privileges(&self) -> Privileges {
        Privileges {
            adapter_id: self.adapter_id.clone(),
            mode: self.permission_mode,
            plan: self.plan_mode,
        }
    }

    /// Side chats, temporary chats, and automation chats are the user's own
    /// scratch space; agents may not list, send to, or drive them.
    #[must_use]
    pub(crate) fn is_agent_addressable(&self) -> bool {
        !self.temporary && !self.automation
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelView {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterView {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub models: Vec<ModelView>,
    pub steer: bool,
    /// Whether this adapter has a distinct `auto` permission mode
    /// (`AdapterCapabilities::auto_mode`). Codex does not: its `default`,
    /// `acceptEdits`, and `auto` all map to the same real privilege
    /// (`permission_mode_policy`), the UI cannot select it, and
    /// `switch_plan.rs` converts `auto` to `default` on a switch there —
    /// so an inherited mode must never land on `auto` for an adapter this
    /// is `false` for (`tools::launch_common::clamp_inherited_mode`).
    pub auto_mode: bool,
}

/// Where a new chat runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchWorkspace {
    ProjectRoot,
    /// Share an existing directory (the caller's worktree, or its root).
    Shared {
        worktree_path: Option<String>,
        branch_name: Option<String>,
    },
    NewWorktree {
        base_branch: String,
        branch_name: String,
    },
    ExistingWorktree {
        worktree_path: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct LaunchRequest {
    pub project_id: String,
    pub adapter_id: String,
    pub model: Option<String>,
    pub permission_mode: ExecutionMode,
    pub plan_mode: bool,
    pub title: Option<String>,
    pub workspace: LaunchWorkspace,
    pub created_by_chat_id: String,
    /// `Some` for a delegated child: the parent it nests under.
    pub parent_chat_id: Option<String>,
}

/// Persistence for `delegated_tasks`. Every failure is internal: the tools
/// never expose storage errors to the model.
pub trait TaskStore: Send + Sync {
    fn insert(&self, task: DelegatedTask) -> BoxFuture<'_, Result<(), PortError>>;
    fn update(&self, task: DelegatedTask) -> BoxFuture<'_, Result<(), PortError>>;
    fn get<'a>(&'a self, task_id: &'a str) -> BoxFuture<'a, Option<DelegatedTask>>;
    fn by_child<'a>(&'a self, child_chat_id: &'a str) -> BoxFuture<'a, Option<DelegatedTask>>;
    fn by_request<'a>(
        &'a self,
        parent_chat_id: &'a str,
        client_request_id: &'a str,
    ) -> BoxFuture<'a, Option<DelegatedTask>>;
    /// The parent's tasks, newest first.
    fn by_parent<'a>(
        &'a self,
        parent_chat_id: &'a str,
        limit: u32,
    ) -> BoxFuture<'a, Vec<DelegatedTask>>;
    fn nonterminal(&self) -> BoxFuture<'_, Vec<DelegatedTask>>;
    fn owed(&self) -> BoxFuture<'_, Vec<DelegatedTask>>;
    /// Boot: marks every unfinished task interrupted (its CLI died with the
    /// previous daemon). Returns how many.
    fn interrupt_unfinished(&self) -> BoxFuture<'_, usize>;
}

pub trait OrchestrationPort: Send + Sync {
    fn chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Option<ChatView>>;
    fn list_chats<'a>(
        &'a self,
        project_id: &'a str,
        include_archived: bool,
    ) -> BoxFuture<'a, Vec<ChatView>>;
    fn project_exists<'a>(&'a self, project_id: &'a str) -> BoxFuture<'a, bool>;
    /// The chat's cached transcript. May load history from disk; never spawns
    /// the chat's CLI.
    fn messages<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Vec<ChatMessage>>;
    fn adapters(&self) -> BoxFuture<'_, Vec<AdapterView>>;
    /// Creates (and, for `NewWorktree`, provisions) a chat. Workspace problems
    /// come back as `PortError::Public(workspace_invalid)`.
    fn launch_chat(&self, request: LaunchRequest) -> BoxFuture<'_, Result<ChatView, PortError>>;
    /// An ordinary send: resumes an offloaded chat, starts a turn when idle.
    fn send<'a>(&'a self, chat_id: &'a str, text: &'a str) -> BoxFuture<'a, Result<(), PortError>>;
    /// Folds `text` into the running turn at the next tool boundary.
    fn steer<'a>(&'a self, chat_id: &'a str, text: &'a str)
    -> BoxFuture<'a, Result<(), PortError>>;
    fn interrupt<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()>;
    /// The daemon event stream. Waiters subscribe before reading state so no
    /// transition between the read and the subscription is lost.
    fn subscribe(&self) -> broadcast::Receiver<DaemonEvent>;
    fn emit(&self, event: DaemonEvent);
    /// `chat_id`'s derived orchestration state changed (its task, its
    /// children's tasks, or the messages held for it): refresh the chat and
    /// re-announce it with `chat.updated`.
    fn chat_changed(&self, chat_id: &str);
}
