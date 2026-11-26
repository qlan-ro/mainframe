//! `OrchestrationService`: the credential registry, the outbox, the limits,
//! and the shared checks every tool runs before touching a chat.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use mainframe_runtime::sync::KeyedMutex;
use mainframe_types::orchestration::OrchestrationMcpLaunch;
use mainframe_types::sync::LockExt as _;

use crate::calls::CallCtx;
use crate::credentials::CredentialRegistry;
use crate::errors::{ErrorCode, PortError, ToolError};
use crate::outbox::Outbox;
use crate::policy::{CreationLimiter, MAX_DEPTH, SystemClock};
use crate::ports::{ChatView, OrchestrationPort, TaskStore};
use crate::state::{ChatState, derive_state};
use crate::turn_flags::Hold;

pub struct OrchestrationService {
    pub(crate) port: Arc<dyn OrchestrationPort>,
    pub(crate) tasks: Arc<dyn TaskStore>,
    credentials: CredentialRegistry,
    pub(crate) limiter: CreationLimiter,
    pub(crate) outbox: Outbox,
    /// Chats whose turn was stopped; cleared when the chat next goes idle.
    pub(crate) stopping: Mutex<HashSet<String>>,
    /// Serializes outbox flushes so two triggers cannot send one batch twice.
    pub(crate) flush_lock: tokio::sync::Mutex<()>,
    /// Serializes task state transitions, so the event loop and a waiting
    /// tool call cannot both finalize (and deliver) one task.
    pub(crate) task_lock: tokio::sync::Mutex<()>,
    /// `child chat id → task id` for every started, nonterminal task: the
    /// event loop's in-memory index of which chat events advance a task.
    pub(crate) active_children: Mutex<HashMap<String, String>>,
    /// One lock per chat that tops a chain of agent-created chats, so two
    /// concurrent `delegate_task` calls in the same tree cannot both pass the
    /// idempotency and limit checks before either inserts its task. Trees
    /// topped by different chats never contend.
    pub(crate) tree_locks: KeyedMutex,
    /// Chats whose held messages wait for their next turn: parents whose owed
    /// deliveries survived a restart (so a restart never wakes every parent),
    /// and chats the last delivery could not reach.
    pub(crate) held: Mutex<HashMap<String, Hold>>,
    /// The chat whose held messages are being sent (`flush_lock` allows one).
    /// They have left the outbox while its turn has not started yet: without
    /// this it reads as idle, and a task run in it as finished.
    delivering: Mutex<Option<String>>,
    version: String,
    endpoint_url: String,
}

impl OrchestrationService {
    #[must_use]
    pub fn new(
        port: Arc<dyn OrchestrationPort>,
        tasks: Arc<dyn TaskStore>,
        version: &str,
        daemon_port: u16,
    ) -> Self {
        let outbox = {
            let port = Arc::clone(&port);
            Outbox::observed(move |target| port.chat_changed(target))
        };
        Self {
            port,
            tasks,
            credentials: CredentialRegistry::default(),
            limiter: CreationLimiter::new(Box::new(SystemClock)),
            outbox,
            stopping: Mutex::new(HashSet::new()),
            flush_lock: tokio::sync::Mutex::new(()),
            task_lock: tokio::sync::Mutex::new(()),
            active_children: Mutex::new(HashMap::new()),
            tree_locks: KeyedMutex::default(),
            held: Mutex::new(HashMap::new()),
            delivering: Mutex::new(None),
            version: version.to_string(),
            // The daemon binds 127.0.0.1 only, so loopback is always right.
            endpoint_url: format!("http://127.0.0.1:{daemon_port}/mcp"),
        }
    }

    #[must_use]
    pub fn credentials(&self) -> &CredentialRegistry {
        &self.credentials
    }

    #[must_use]
    pub fn version(&self) -> &str {
        &self.version
    }

    /// The credential for one spawn of `chat_id` (revoking any earlier one).
    #[must_use]
    pub fn issue_launch(&self, chat_id: &str, session_id: &str) -> OrchestrationMcpLaunch {
        self.release(chat_id);
        OrchestrationMcpLaunch {
            url: self.endpoint_url.clone(),
            token: self.credentials.issue(chat_id, session_id),
        }
    }

    pub fn revoke(&self, chat_id: &str) {
        self.credentials.revoke_chat(chat_id);
    }

    pub async fn reserve_idle_close(&self, chat_id: &str) -> Option<Box<dyn Send>> {
        match self.reserve_idle_tree(chat_id).await {
            Ok(guard) => guard.map(|guard| Box::new(guard) as Box<dyn Send>),
            Err(error) => {
                tracing::warn!(chat_id, %error, "could not check delegated work before offload");
                None
            }
        }
    }

    async fn reserve_idle_tree(
        &self,
        chat_id: &str,
    ) -> Result<Option<tokio::sync::OwnedMutexGuard<()>>, PortError> {
        let Some(chat) = self.port.chat(chat_id).await? else {
            return Ok(None);
        };
        let Ok(guard) = self
            .tree_locks
            .get(&self.tree_key(&chat).await?)
            .try_lock_owned()
        else {
            return Ok(None);
        };
        let busy = self
            .tasks
            .nonterminal()
            .await?
            .iter()
            .any(|task| task.parent_chat_id == chat_id || task.child_chat_id == chat_id);
        Ok((!busy).then_some(guard))
    }

    // ── checks shared by the tools ────────────────────────────────────────

    pub(crate) async fn caller_chat(&self, ctx: &CallCtx) -> Result<ChatView, ToolError> {
        self.port.chat(&ctx.caller.chat_id).await?.ok_or_else(|| {
            ToolError::new(
                ErrorCode::CallerNotActive,
                "The calling chat no longer exists.",
            )
        })
    }

    /// Mutating tools run only inside the caller's live turn, so a stale
    /// process whose turn already ended cannot act.
    pub(crate) async fn active_caller(&self, ctx: &CallCtx) -> Result<ChatView, ToolError> {
        let chat = self.caller_chat(ctx).await?;
        if !chat.working || self.is_stopping(&chat.id) || ctx.cancel.is_cancelled() {
            return Err(ToolError::new(
                ErrorCode::CallerNotActive,
                "Mutating tools may only be called during the caller's active turn.",
            ));
        }
        Ok(chat)
    }

    /// A chat an agent may address: agent-addressable (not side, temporary,
    /// or automation), and either in the caller's own project or within the
    /// caller's own lineage (see [`Self::in_scope`]). Anything else reads as
    /// not found, same as a chat that does not exist, so a caller cannot
    /// learn that an out-of-scope id exists at all.
    pub(crate) async fn target_chat(
        &self,
        chat_id: &str,
        caller: &ChatView,
    ) -> Result<ChatView, ToolError> {
        match self.port.chat(chat_id).await? {
            Some(chat) if chat.is_agent_addressable() && self.in_scope(caller, &chat).await? => {
                Ok(chat)
            }
            _ => Err(ToolError::new(
                ErrorCode::ChatNotFound,
                format!("No chat {chat_id}."),
            )),
        }
    }

    /// Whether `caller` may address `target`: they share a project, or
    /// `caller` created `target` directly or transitively — walking
    /// `target`'s own `created_by_chat_id` chain, not `caller`'s, because a
    /// `chat_launch` into another project (or "no-project") puts the new
    /// chat's `created_by_chat_id` on the NEW chat, pointing back at the
    /// caller, while the two chats' `projectId`s differ. Delegated children
    /// always inherit their parent's project already (`delegate_task::
    /// build_request`), so same-project alone already covers a task tree;
    /// this walk is what `chat_launch` into another project (or
    /// "no-project") needs, and it also covers a chain of plain launches
    /// (the caller launched X, X later launched Y: the caller may still
    /// reach Y).
    pub(crate) async fn in_scope(
        &self,
        caller: &ChatView,
        target: &ChatView,
    ) -> Result<bool, PortError> {
        if target.project_id == caller.project_id {
            return Ok(true);
        }
        Ok(self.creators(target).await?.contains(&caller.id))
    }

    /// `chat` as it now stands, for a reply. The work is done by then, so a
    /// failed read reports the older view instead of failing the call.
    pub(crate) async fn reread(&self, chat: ChatView) -> ChatView {
        match self.port.chat(&chat.id).await {
            Ok(fresh) => fresh.unwrap_or(chat),
            Err(err) => {
                tracing::warn!(chat_id = chat.id, error = %err, "failed to re-read a chat");
                chat
            }
        }
    }

    #[must_use]
    pub(crate) fn state_of(&self, chat: &ChatView) -> ChatState {
        let delivering = self.delivering.lock_recover().as_ref() == Some(&chat.id);
        derive_state(chat, delivering || self.outbox.has_for(&chat.id))
    }

    pub(crate) fn set_delivering(&self, chat_id: Option<&str>) {
        *self.delivering.lock_recover() = chat_id.map(str::to_string);
    }

    /// The chats whose agents created `chat`, nearest first. Cut off one past
    /// [`MAX_DEPTH`] so a corrupt cycle cannot spin.
    async fn creators(&self, chat: &ChatView) -> Result<Vec<String>, PortError> {
        let mut creators = Vec::new();
        let mut next = chat.created_by_chat_id.clone();
        while let Some(id) = next {
            let creator = self.port.chat(&id).await?;
            creators.push(id);
            if creators.len() > MAX_DEPTH {
                break;
            }
            next = creator.and_then(|c| c.created_by_chat_id);
        }
        Ok(creators)
    }

    /// Length of the creator chain above `chat`, at most one past [`MAX_DEPTH`].
    pub(crate) async fn depth_of(&self, chat: &ChatView) -> Result<usize, PortError> {
        Ok(self.creators(chat).await?.len())
    }

    /// The key of `chat`'s entry in [`Self::tree_locks`]. Unlike the tree the
    /// task limits count, which shrinks as tasks finish, the creator chain
    /// never changes, so two calls from one tree always share a lock.
    pub(crate) async fn tree_key(&self, chat: &ChatView) -> Result<String, PortError> {
        let top = self.creators(chat).await?.pop();
        Ok(top.unwrap_or_else(|| chat.id.clone()))
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
