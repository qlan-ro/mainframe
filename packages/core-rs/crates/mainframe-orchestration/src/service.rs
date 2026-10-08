//! `OrchestrationService`: the credential registry, the outbox, the limits,
//! and the shared checks every tool runs before touching a chat.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use mainframe_types::orchestration::OrchestrationMcpLaunch;
use tokio_util::sync::CancellationToken;

use crate::credentials::{Caller, CredentialRegistry};
use crate::errors::{ErrorCode, ToolError};
use crate::outbox::Outbox;
use crate::policy::{CreationLimiter, MAX_DEPTH, SystemClock};
use crate::ports::{ChatView, OrchestrationPort, TaskStore};
use crate::state::{ChatState, derive_state};

/// One in-flight `tools/call`: who made it and how to abandon it.
pub struct CallCtx {
    pub caller: Caller,
    pub cancel: CancellationToken,
}

pub struct OrchestrationService {
    pub(crate) port: Arc<dyn OrchestrationPort>,
    pub(crate) tasks: Arc<dyn TaskStore>,
    credentials: CredentialRegistry,
    pub(crate) limiter: CreationLimiter,
    pub(crate) outbox: Outbox,
    /// Chats whose turn was stopped; cleared when the chat next goes idle.
    stopping: Mutex<HashSet<String>>,
    inflight: Mutex<HashMap<(String, String), CancellationToken>>,
    /// Serializes outbox flushes so two triggers cannot send one batch twice.
    pub(crate) flush_lock: tokio::sync::Mutex<()>,
    /// Serializes task state transitions, so the event loop and a waiting
    /// tool call cannot both finalize (and deliver) one task.
    pub(crate) task_lock: tokio::sync::Mutex<()>,
    /// `child chat id → task id` for every started, nonterminal task: the
    /// event loop's in-memory index of which chat events advance a task.
    pub(crate) active_children: Mutex<HashMap<String, String>>,
    /// One lock per delegation-tree root, so two concurrent `delegate_task`
    /// calls in the same tree cannot both pass the idempotency and limit
    /// checks before either inserts (`tools/delegate_task.rs::run`). Trees
    /// rooted at different chats never contend.
    pub(crate) tree_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Parents whose owed deliveries survived a restart; held until the
    /// parent's CLI spawns again, so a restart never wakes every parent.
    pub(crate) boot_held: Mutex<HashSet<String>>,
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
            credentials: CredentialRegistry::new(),
            limiter: CreationLimiter::new(Box::new(SystemClock)),
            outbox,
            stopping: Mutex::new(HashSet::new()),
            inflight: Mutex::new(HashMap::new()),
            flush_lock: tokio::sync::Mutex::new(()),
            task_lock: tokio::sync::Mutex::new(()),
            active_children: Mutex::new(HashMap::new()),
            tree_locks: Mutex::new(HashMap::new()),
            boot_held: Mutex::new(HashSet::new()),
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
        self.boot_held
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(chat_id);
        OrchestrationMcpLaunch {
            url: self.endpoint_url.clone(),
            token: self.credentials.issue(chat_id, session_id),
        }
    }

    pub fn revoke(&self, chat_id: &str) {
        self.credentials.revoke_chat(chat_id);
    }

    /// Stop step 1: end the chat's in-flight calls and refuse late mutating
    /// calls from the stopped turn until the chat goes idle.
    pub fn mark_stopping(&self, chat_id: &str) {
        self.credentials.cancel_inflight(chat_id);
        self.lock_stopping().insert(chat_id.to_string());
    }

    pub(crate) fn clear_stopping(&self, chat_id: &str) {
        self.lock_stopping().remove(chat_id);
    }

    pub(crate) fn is_stopping(&self, chat_id: &str) -> bool {
        self.lock_stopping().contains(chat_id)
    }

    fn lock_stopping(&self) -> std::sync::MutexGuard<'_, HashSet<String>> {
        self.stopping.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Registers a call so `notifications/cancelled` can abandon it.
    pub(crate) fn begin_call(&self, caller: &Caller, request_id: &str) -> CallCtx {
        let cancel = caller.cancel.child_token();
        self.lock_inflight().insert(
            (caller.chat_id.clone(), request_id.to_string()),
            cancel.clone(),
        );
        CallCtx {
            caller: caller.clone(),
            cancel,
        }
    }

    pub(crate) fn end_call(&self, caller: &Caller, request_id: &str) {
        self.lock_inflight()
            .remove(&(caller.chat_id.clone(), request_id.to_string()));
    }

    pub(crate) fn cancel_call(&self, caller: &Caller, request_id: &str) {
        let key = (caller.chat_id.clone(), request_id.to_string());
        if let Some(token) = self.lock_inflight().remove(&key) {
            token.cancel();
        }
    }

    fn lock_inflight(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<(String, String), CancellationToken>> {
        self.inflight.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ── checks shared by the tools ────────────────────────────────────────

    pub(crate) async fn caller_chat(&self, ctx: &CallCtx) -> Result<ChatView, ToolError> {
        self.port.chat(&ctx.caller.chat_id).await.ok_or_else(|| {
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
        match self.port.chat(chat_id).await {
            Some(chat) if chat.is_agent_addressable() && self.in_scope(caller, &chat).await => {
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
    /// reach Y). Bounded the same way `depth_of` is, so a corrupt cycle
    /// cannot spin.
    pub(crate) async fn in_scope(&self, caller: &ChatView, target: &ChatView) -> bool {
        if target.project_id == caller.project_id {
            return true;
        }
        let mut next = target.created_by_chat_id.clone();
        for _ in 0..=MAX_DEPTH {
            match next {
                Some(id) if id == caller.id => return true,
                Some(id) => next = self.port.chat(&id).await.and_then(|c| c.created_by_chat_id),
                None => return false,
            }
        }
        false
    }

    #[must_use]
    pub fn state_of(&self, chat: &ChatView) -> ChatState {
        derive_state(chat, self.outbox.has_for(&chat.id))
    }

    /// The lock for the whole tree `root_id` roots: `delegate_task` awaits
    /// it (`.lock().await`) across its idempotency check, limit check, and
    /// insert, so that sequence runs atomically with respect to every other
    /// concurrent delegation in the same tree. Find the root first with
    /// `tasks_ops::tree_root`. Trees rooted at different chats never
    /// contend; this map only grows, but by at most one entry per root chat
    /// that has ever delegated, which is bounded by how many chats exist.
    pub(crate) fn tree_lock(&self, root_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.tree_locks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(root_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    /// Length of the `created_by` chain above `chat`, capped one past
    /// [`MAX_DEPTH`] so a corrupt cycle cannot spin.
    pub(crate) async fn depth_of(&self, chat: &ChatView) -> u32 {
        let mut depth = 0;
        let mut next = chat.created_by_chat_id.clone();
        while let Some(parent) = next {
            depth += 1;
            if depth > MAX_DEPTH {
                break;
            }
            next = self
                .port
                .chat(&parent)
                .await
                .and_then(|c| c.created_by_chat_id);
        }
        depth
    }
}
