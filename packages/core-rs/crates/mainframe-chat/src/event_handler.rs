//! Ported from `packages/core/src/chat/event-handler.ts`.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::SessionSink;
use mainframe_runtime::time::now_iso8601;
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, DetectedPr, MessageMetadata, ProviderQuota, SessionResult,
};
use mainframe_types::chat::{
    ChatMessage, ChatMessageType, MessageContent, MessageContentNode, ProcessState,
    QueuedMessageRef, TodoItem,
};
use mainframe_types::content::LeafContent;
use mainframe_types::context::SkillFileEntry;
use mainframe_types::display::{DisplayMessage, ToolCategories};
use mainframe_types::events::{ChatNotificationLevel, ChatUpdatedReason, DaemonEvent};
use tracing::{debug, warn};

use crate::display_emitter::emit_display_delta;
use crate::message_cache::MessageCache;
use crate::permission_manager::PermissionManager;
use crate::types::ActiveChat;

const PUSH_BODY_MAX_LENGTH: usize = 200;

/// Shared display-delta base cache, keyed by chat (never shared cross-chat).
pub type DisplayCache = Arc<Mutex<HashMap<String, Vec<DisplayMessage>>>>;

/// A fire-and-forget push notification (`pushService.sendPush`).
#[derive(Debug, Clone, PartialEq)]
pub struct PushOut {
    pub chat_id: String,
    pub title: String,
    pub body: String,
    pub push_type: String,
    pub priority: String,
}

/// Partial `db.chats.update` patch the sink writes. `process_state` is tri-state
/// (`None` absent, `Some(None)` explicit null, `Some(Some(x))` value).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EventChatUpdate {
    pub claude_session_id: Option<String>,
    pub session_file_path: Option<String>,
    pub plan_mode: Option<bool>,
    pub total_cost: Option<f64>,
    pub total_tokens_input: Option<i64>,
    pub total_tokens_output: Option<i64>,
    pub last_context_tokens_input: Option<i64>,
    /// The CLI's own context totals (`onContextUsage`) — persisted so the meter
    /// survives reloads (#197).
    pub last_context_total_tokens: Option<u64>,
    pub last_context_max_tokens: Option<u64>,
    pub process_state: Option<Option<ProcessState>>,
    pub updated_at: Option<String>,
}

/// The injected dependency surface (mirrors the TS `EventHandler` constructor
/// callbacks + `db`). Claude-specific pieces (`stripMainframeCommandTags`, the
/// display pipeline) and the not-Send db repos are narrowed to trait methods so
/// this crate needs no adapter-claude/db dependency.
pub trait EventHandlerDeps: Send + Sync {
    fn get_active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>>;
    fn emit_event(&self, event: DaemonEvent);
    fn get_tool_categories(&self, chat_id: &str) -> Option<ToolCategories>;
    fn on_queued_processed(&self, chat_id: &str, uuid: &str);
    fn on_queued_cleared(&self, chat_id: &str);
    fn get_queued_refs(&self, chat_id: &str) -> Vec<QueuedMessageRef>;
    /// `prepareMessagesForClient` (Claude-specific; injected to avoid a cycle).
    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage>;
    /// `stripMainframeCommandTags` (Claude-specific; injected).
    fn strip_command_tags(&self, text: &str) -> String;

    // db surface --------------------------------------------------------------
    fn chats_update(&self, chat_id: &str, patch: &EventChatUpdate);
    fn projects_get_path(&self, project_id: &str) -> Option<String>;
    fn add_plan_file(&self, chat_id: &str, file_path: &str) -> bool;
    fn add_skill_file(&self, chat_id: &str, entry: &SkillFileEntry) -> bool;
    fn update_todos(&self, chat_id: &str, todos: &[TodoItem]);
    fn add_detected_prs(&self, chat_id: &str, prs: &[DetectedPr]) -> Vec<DetectedPr>;

    // notifications + push ----------------------------------------------------
    fn should_notify_permission(&self, tool_name: Option<&str>) -> bool;
    fn notify_task_complete(&self) -> bool;
    fn notify_session_error(&self) -> bool;
    fn send_push(&self, _msg: PushOut) {}

    /// `tracker?.endAllRunning(chatId)` — stop every live background task on session
    /// end (the CLI owns them; none can report completion after it dies). Default
    /// no-op mirrors the TS optional `tracker?`.
    fn tracker_end_all_running(&self, _chat_id: &str) {}

    /// `onProviderQuota(adapterId, quota)` — an account-wide provider-plan quota
    /// escalation pushed from a session event (Codex `account/rateLimits/updated`,
    /// Claude `rate_limit_event`). Default no-op mirrors the TS optional callback: a
    /// ChatManager built without a QuotaManager simply drops it.
    fn on_provider_quota(&self, _adapter_id: &str, _quota: ProviderQuota) {}
}

/// `computeSessionFilePath` — encode a cwd the Claude way and point at the jsonl.
pub fn compute_session_file_path(cwd: &str, session_id: &str) -> String {
    let encoded = sanitize(cwd);
    let safe_session = sanitize(session_id);
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".claude")
        .join("projects")
        .join(encoded)
        .join(format!("{safe_session}.jsonl"))
        .to_string_lossy()
        .into_owned()
}

/// `s.replace(/[^a-zA-Z0-9-]/g, '-')`.
fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

fn get_last_assistant_text(msgs: Option<&Vec<ChatMessage>>) -> String {
    let Some(msgs) = msgs else {
        return String::new();
    };
    for msg in msgs.iter().rev() {
        if msg.r#type != ChatMessageType::Assistant {
            continue;
        }
        for block in msg.content.iter().rev() {
            if let MessageContent::Leaf(LeafContent::Text { text, .. }) = block {
                let text = text.trim();
                if text.is_empty() {
                    continue;
                }
                if text.chars().count() <= PUSH_BODY_MAX_LENGTH {
                    return text.to_string();
                }
                let head: String = text.chars().take(PUSH_BODY_MAX_LENGTH - 1).collect();
                return format!("{head}\u{2026}");
            }
        }
    }
    String::new()
}

pub struct EventHandler<D: EventHandlerDeps + 'static> {
    messages: Arc<Mutex<MessageCache>>,
    permissions: Arc<Mutex<PermissionManager>>,
    display_cache: DisplayCache,
    deps: Arc<D>,
}

impl<D: EventHandlerDeps + 'static> EventHandler<D> {
    pub fn new(
        messages: Arc<Mutex<MessageCache>>,
        permissions: Arc<Mutex<PermissionManager>>,
        deps: Arc<D>,
    ) -> Self {
        Self {
            messages,
            permissions,
            display_cache: Arc::new(Mutex::new(HashMap::new())),
            deps,
        }
    }

    /// `buildSink(chatId, sessionId, respondToPermission)`. The TS sink never calls
    /// `respondToPermission` (it is `_respondToPermission`), so the Rust sink drops
    /// it; chat_manager retains the callback separately.
    pub fn build_sink(
        &self,
        chat_id: &str,
        built_for_session_id: Option<String>,
    ) -> Arc<dyn SessionSink> {
        Arc::new(SessionSinkImpl {
            chat_id: chat_id.to_string(),
            built_for_session_id,
            messages: self.messages.clone(),
            permissions: self.permissions.clone(),
            display_cache: self.display_cache.clone(),
            deps: self.deps.clone(),
            pending_file_paths: Mutex::new(HashMap::new()),
            pending_subagent_ids: Mutex::new(HashSet::new()),
        })
    }

    /// Emit display delta for a chat (code paths outside the session sink).
    pub fn emit_display(&self, chat_id: &str) {
        let categories = self.deps.get_tool_categories(chat_id);
        emit_display_for(
            chat_id,
            &self.messages,
            &self.display_cache,
            categories.as_ref(),
            self.deps.as_ref(),
        );
    }

    /// Remove display cache entry for a chat (call on chat end/archive).
    pub fn clear_display_cache(&self, chat_id: &str) {
        self.display_cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(chat_id);
    }
}

/// Shared `emitDisplay` used by both `EventHandler::emit_display` and the sink.
/// The injected `emit_event` is a non-reentrant channel send in the daemon (it
/// fans out to WS clients, never back into these locks), so holding the message +
/// display-cache locks across it cannot deadlock (CONCURRENCY.tsv rule 3 note).
fn emit_display_for<D: EventHandlerDeps>(
    chat_id: &str,
    messages: &Arc<Mutex<MessageCache>>,
    display_cache: &DisplayCache,
    categories: Option<&ToolCategories>,
    deps: &D,
) {
    let msgs = messages.lock().unwrap_or_else(|e| e.into_inner());
    let mut cache = display_cache.lock().unwrap_or_else(|e| e.into_inner());
    let prepare =
        |raw: &[ChatMessage], c: Option<&ToolCategories>| deps.prepare_messages_for_client(raw, c);
    let mut emit = |e: DaemonEvent| deps.emit_event(e);
    emit_display_delta(chat_id, &msgs, &mut cache, categories, &prepare, &mut emit);
}

struct SessionSinkImpl<D: EventHandlerDeps + 'static> {
    chat_id: String,
    built_for_session_id: Option<String>,
    messages: Arc<Mutex<MessageCache>>,
    permissions: Arc<Mutex<PermissionManager>>,
    display_cache: DisplayCache,
    deps: Arc<D>,
    pending_file_paths: Mutex<HashMap<String, String>>,
    pending_subagent_ids: Mutex<HashSet<String>>,
}

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    fn emit_display(&self) {
        let categories = self.deps.get_tool_categories(&self.chat_id);
        emit_display_for(
            &self.chat_id,
            &self.messages,
            &self.display_cache,
            categories.as_ref(),
            self.deps.as_ref(),
        );
    }

    fn append_and_emit(&self, message: ChatMessage) {
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .append(&self.chat_id, message.clone());
        self.deps.emit_event(DaemonEvent::MessageAdded {
            chat_id: self.chat_id.clone(),
            message,
        });
        self.emit_display();
    }

    fn transient(
        &self,
        r#type: ChatMessageType,
        content: Vec<MessageContent>,
        metadata: Option<HashMap<String, serde_json::Value>>,
    ) -> ChatMessage {
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .create_transient_message(&self.chat_id, r#type, content, metadata)
    }

    /// `MessageCache` exposes only immutable `get`; in-place message mutation
    /// (TS `delete m.metadata.queued`) is reproduced by clone → mutate → `set`
    /// (`set` on an existing key replaces the vec without disturbing its slot).
    fn mutate_messages<R>(&self, f: impl FnOnce(&mut Vec<ChatMessage>) -> R) -> Option<R> {
        let mut msgs = self.messages.lock().unwrap_or_else(|e| e.into_inner());
        let mut v = msgs.get(&self.chat_id)?.clone();
        let r = f(&mut v);
        msgs.set(&self.chat_id, v);
        Some(r)
    }
}

/// Strip `queued`/`uuid` metadata from the message with `id`, then move it to the
/// end (mirrors `delete m.metadata.queued; messages.moveToEnd(id)`).
fn strip_queued_and_move(v: &mut Vec<ChatMessage>, id: &str) {
    let Some(pos) = v.iter().position(|m| m.id == id) else {
        return;
    };
    if let Some(md) = v[pos].metadata.as_mut() {
        md.remove("queued");
        md.remove("uuid");
    }
    let m = v.remove(pos);
    v.push(m);
}

fn is_queued(m: &ChatMessage) -> bool {
    m.metadata
        .as_ref()
        .and_then(|md| md.get("queued"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

impl<D: EventHandlerDeps + 'static> SessionSink for SessionSinkImpl<D> {
    fn on_init(&self, session_id: &str) {
        let Some(cell) = self.deps.get_active_chat(&self.chat_id) else {
            return;
        };
        let (project_id, worktree_path, session_process_id) = {
            let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            guard.chat.claude_session_id = Some(session_id.to_string());
            (
                guard.chat.project_id.clone(),
                guard.chat.worktree_path.clone(),
                guard.session.as_ref().map(|s| s.id().to_string()),
            )
        };
        self.deps.chats_update(
            &self.chat_id,
            &EventChatUpdate {
                claude_session_id: Some(session_id.to_string()),
                ..Default::default()
            },
        );
        let project_path = self.deps.projects_get_path(&project_id);
        let cwd = worktree_path.or(project_path);
        if let Some(cwd) = cwd {
            let session_file_path = compute_session_file_path(&cwd, session_id);
            self.deps.chats_update(
                &self.chat_id,
                &EventChatUpdate {
                    session_file_path: Some(session_file_path.clone()),
                    ..Default::default()
                },
            );
            cell.lock()
                .unwrap_or_else(|e| e.into_inner())
                .chat
                .session_file_path = Some(session_file_path);
        }
        self.deps.emit_event(DaemonEvent::ProcessReady {
            process_id: session_process_id.unwrap_or_default(),
            claude_session_id: session_id.to_string(),
        });
    }

    fn on_message(&self, content: Vec<MessageContent>, metadata: Option<MessageMetadata>) {
        debug!(
            chat_id = self.chat_id,
            block_count = content.len(),
            "assistant message received"
        );

        // Drain-turn re-entry: a background task's completion re-invokes the turn
        // (task_notification → fresh init → assistant message → second result)
        // AFTER the first result already set processState to 'idle'. A top-level
        // assistant event means the main agent is speaking again — flip back to
        // 'working' so the thread indicator runs; the drain turn's own result
        // clears it via the normal onResult path. Version-proof: on hold-back CLIs
        // the state is still 'working' here, so this never fires.
        if let Some(cell) = self.deps.get_active_chat(&self.chat_id) {
            let updated = {
                let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
                if guard.chat.process_state != Some(Some(ProcessState::Working)) {
                    guard.chat.process_state = Some(Some(ProcessState::Working));
                    Some(guard.chat.clone())
                } else {
                    None
                }
            };
            if let Some(chat) = updated {
                self.deps.chats_update(
                    &self.chat_id,
                    &EventChatUpdate {
                        process_state: Some(Some(ProcessState::Working)),
                        ..Default::default()
                    },
                );
                self.deps
                    .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
            }
        }

        let categories = self.deps.get_tool_categories(&self.chat_id);
        for block in &content {
            if let MessageContent::Node(MessageContentNode::ToolUse {
                id, name, input, ..
            }) = block
            {
                if (name == "Write" || name == "Edit")
                    && let Some(fp) = input.get("file_path").and_then(|v| v.as_str())
                {
                    self.pending_file_paths
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(id.clone(), fp.to_string());
                }
                if categories
                    .as_ref()
                    .is_some_and(|c| c.subagent.contains(name))
                {
                    self.pending_subagent_ids
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(id.clone());
                }
            }
        }
        let has_enter_plan_mode = content.iter().any(|b| {
            matches!(b, MessageContent::Node(MessageContentNode::ToolUse { name, .. }) if name == "EnterPlanMode")
        });
        if has_enter_plan_mode && let Some(cell) = self.deps.get_active_chat(&self.chat_id) {
            let updated = {
                let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
                if guard.chat.plan_mode != Some(true) {
                    guard.chat.plan_mode = Some(true);
                    Some(guard.chat.clone())
                } else {
                    None
                }
            };
            if let Some(chat) = updated {
                self.deps.chats_update(
                    &self.chat_id,
                    &EventChatUpdate {
                        plan_mode: Some(true),
                        ..Default::default()
                    },
                );
                self.deps
                    .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
            }
        }

        // Strip mainframe command response tags from assistant text blocks.
        let cleaned: Vec<MessageContent> = content
            .into_iter()
            .map(|block| match block {
                MessageContent::Leaf(LeafContent::Text {
                    text,
                    parent_tool_use_id,
                }) => {
                    let stripped = self.deps.strip_command_tags(&text);
                    MessageContent::Leaf(LeafContent::Text {
                        text: stripped,
                        parent_tool_use_id,
                    })
                }
                other => other,
            })
            .collect();

        let adapter_id = self.deps.get_active_chat(&self.chat_id).and_then(|c| {
            c.lock()
                .unwrap_or_else(|e| e.into_inner())
                .session
                .as_ref()
                .map(|s| s.adapter_id().to_string())
        });
        let mut meta: HashMap<String, serde_json::Value> = HashMap::new();
        if let Some(a) = adapter_id {
            meta.insert("adapterId".to_string(), serde_json::Value::String(a));
        }
        if let Some(m) = metadata {
            if let Some(model) = m.model {
                meta.insert("model".to_string(), serde_json::Value::String(model));
            }
            if let Some(usage) = m.usage
                && let Ok(v) = serde_json::to_value(usage)
            {
                meta.insert("usage".to_string(), v);
            }
        }
        let message = self.transient(ChatMessageType::Assistant, cleaned, Some(meta));
        self.append_and_emit(message);
    }

    fn on_tool_result(&self, content: Vec<MessageContent>) {
        let mut edited_paths: Vec<String> = Vec::new();
        let mut subagent_completed = false;
        for block in &content {
            if let MessageContent::Node(MessageContentNode::ToolResult {
                tool_use_id,
                is_error,
                ..
            }) = block
            {
                if *is_error {
                    continue;
                }
                let fp = self
                    .pending_file_paths
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(tool_use_id);
                if let Some(fp) = fp {
                    edited_paths.push(fp);
                }
                if self
                    .pending_subagent_ids
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(tool_use_id)
                {
                    subagent_completed = true;
                }
            }
        }

        let message = self.transient(ChatMessageType::ToolResult, content, None);
        self.append_and_emit(message);

        if !edited_paths.is_empty() {
            self.deps.emit_event(DaemonEvent::ContextUpdated {
                chat_id: self.chat_id.clone(),
                file_paths: Some(edited_paths),
            });
        } else if subagent_completed {
            self.deps.emit_event(DaemonEvent::ContextUpdated {
                chat_id: self.chat_id.clone(),
                file_paths: None,
            });
        }
    }

    fn on_permission(&self, request: ControlRequest) {
        let is_first = self
            .permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .enqueue(&self.chat_id, request.clone());
        if is_first {
            let notify = self.deps.should_notify_permission(Some(&request.tool_name));
            self.deps.emit_event(DaemonEvent::PermissionRequested {
                chat_id: self.chat_id.clone(),
                request: request.clone(),
                notify,
            });
            if let Some(cell) = self.deps.get_active_chat(&self.chat_id) {
                let chat = cell.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
                self.deps
                    .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
            }
            if notify {
                let tool = &request.tool_name;
                self.deps.send_push(PushOut {
                    chat_id: self.chat_id.clone(),
                    title: "Permission Required".to_string(),
                    body: format!("Agent wants to run: {tool}"),
                    push_type: "permission".to_string(),
                    priority: "high".to_string(),
                });
            }
        }
    }

    fn on_result(&self, data: SessionResult) {
        let Some(cell) = self.deps.get_active_chat(&self.chat_id) else {
            return;
        };

        let cost = data.total_cost_usd.unwrap_or(0.0);
        let tokens_input = data
            .usage
            .as_ref()
            .and_then(|u| u.input_tokens)
            .unwrap_or(0);
        let tokens_output = data
            .usage
            .as_ref()
            .and_then(|u| u.output_tokens)
            .unwrap_or(0);

        let (new_cost, new_input, new_output) = {
            let guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            (
                guard.chat.total_cost + cost,
                guard.chat.total_tokens_input + tokens_input,
                guard.chat.total_tokens_output + tokens_output,
            )
        };
        let now = now_iso8601();

        // Reconcile cached metadata.queued ↔ chat-manager queuedRefs.
        let refs_before = self.deps.get_queued_refs(&self.chat_id);
        let ref_uuids: HashSet<String> = refs_before.iter().map(|r| r.uuid.clone()).collect();
        let mut cached_queued_uuids: HashSet<String> = HashSet::new();
        let mut display_changed = false;

        // Snapshot ids so moveToEnd (which splices the live vec) can't shift the loop.
        let snapshot: Vec<(String, Option<String>, bool)> = {
            let msgs = self.messages.lock().unwrap_or_else(|e| e.into_inner());
            msgs.get(&self.chat_id)
                .map(|v| {
                    v.iter()
                        .map(|m| {
                            let uuid = m
                                .metadata
                                .as_ref()
                                .and_then(|md| md.get("uuid"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            let queued = m
                                .metadata
                                .as_ref()
                                .and_then(|md| md.get("queued"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            (m.id.clone(), uuid, queued)
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        for (id, uuid, queued) in snapshot {
            if let (true, Some(u)) = (queued, uuid) {
                cached_queued_uuids.insert(u.clone());
                if !ref_uuids.contains(&u) {
                    self.mutate_messages(|v| strip_queued_and_move(v, &id));
                    display_changed = true;
                    warn!(
                        chat_id = self.chat_id,
                        uuid = u,
                        "onResult: orphan metadata.queued (no matching ref) — clearing"
                    );
                    self.deps.emit_event(DaemonEvent::MessageQueuedProcessed {
                        chat_id: self.chat_id.clone(),
                        uuid: u.clone(),
                    });
                    self.deps.on_queued_processed(&self.chat_id, &u);
                }
            }
        }

        for r in &refs_before {
            if !cached_queued_uuids.contains(&r.uuid) {
                warn!(
                    chat_id = self.chat_id,
                    uuid = r.uuid,
                    "onResult: orphan queuedRef (no matching cached message) — pruning"
                );
                self.deps.emit_event(DaemonEvent::MessageQueuedProcessed {
                    chat_id: self.chat_id.clone(),
                    uuid: r.uuid.clone(),
                });
                self.deps.on_queued_processed(&self.chat_id, &r.uuid);
            }
        }

        if display_changed {
            self.emit_display();
        }

        let refs_after = self.deps.get_queued_refs(&self.chat_id);
        self.deps.emit_event(DaemonEvent::MessageQueuedSnapshot {
            chat_id: self.chat_id.clone(),
            refs: refs_after.clone(),
        });

        let queue_remaining = refs_after.len();
        let next_process_state = if queue_remaining > 0 {
            ProcessState::Working
        } else {
            ProcessState::Idle
        };

        // Context size: prefer the adapter's explicit per-turn report
        // (`contextTokens`; None = "unknown this turn — keep the stored value").
        // Each adapter resolves the value at its source: claude sends the last
        // parent assistant usage (or None when unknown), and codex resolves the TS
        // sink's `undefined → fall back to usage` path at its boundary by sending
        // this turn's raw input usage (event-handler.ts:366). So None always means
        // "keep stored" here; a zero must never clobber a real stored size.
        let context_update: Option<i64> = data.context_tokens.filter(|&v| v > 0);

        self.deps.chats_update(
            &self.chat_id,
            &EventChatUpdate {
                total_cost: Some(new_cost),
                total_tokens_input: Some(new_input),
                total_tokens_output: Some(new_output),
                last_context_tokens_input: context_update,
                process_state: Some(Some(next_process_state)),
                updated_at: Some(now.clone()),
                ..Default::default()
            },
        );
        {
            let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
            guard.chat.total_cost = new_cost;
            guard.chat.total_tokens_input = new_input;
            guard.chat.total_tokens_output = new_output;
            if let Some(v) = context_update {
                guard.chat.last_context_tokens_input = v;
            }
            guard.chat.process_state = Some(Some(next_process_state));
            guard.chat.updated_at = now;
        }

        let was_interrupted = self
            .permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear_interrupted(&self.chat_id);
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear(&self.chat_id);

        let is_error = data.subtype.as_deref() == Some("error_during_execution")
            && data.is_error != Some(false);
        let reason = if was_interrupted {
            ChatUpdatedReason::Interrupted
        } else if is_error {
            ChatUpdatedReason::Error
        } else {
            ChatUpdatedReason::Completed
        };
        let chat = cell.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
        debug!(
            chat_id = self.chat_id,
            ?reason,
            was_interrupted,
            is_error,
            "onResult: emitting chat.updated with processState=idle"
        );
        self.deps.emit_event(DaemonEvent::ChatUpdated {
            chat,
            reason: Some(reason),
        });

        // Turn duration for the MessageTiming pill.
        let turn_started_at = cell
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .turn_started_at
            .take();
        if let Some(started) = turn_started_at {
            let turn_duration_ms = now_ms() - started;
            let mut md: HashMap<String, serde_json::Value> = HashMap::new();
            md.insert(
                "turnDurationMs".to_string(),
                serde_json::json!(turn_duration_ms),
            );
            let timing = self.transient(ChatMessageType::System, Vec::new(), Some(md));
            self.append_and_emit(timing);
        }

        if is_error {
            if !was_interrupted {
                let detail = data
                    .result
                    .as_deref()
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default();
                warn!(
                    chat_id = self.chat_id,
                    subtype = ?data.subtype,
                    "session ended unexpectedly — emitting error message"
                );
                let msg_text = if detail.is_empty() {
                    "Session ended unexpectedly".to_string()
                } else {
                    detail
                };
                let message = self.transient(
                    ChatMessageType::Error,
                    vec![MessageContent::Node(MessageContentNode::Error {
                        message: msg_text,
                        parent_tool_use_id: None,
                    })],
                    None,
                );
                self.append_and_emit(message);

                if self.deps.notify_session_error() {
                    self.deps.emit_event(DaemonEvent::ChatNotification {
                        chat_id: self.chat_id.clone(),
                        title: "Session Error".to_string(),
                        body: "A session ended unexpectedly".to_string(),
                        level: ChatNotificationLevel::Error,
                    });
                    self.deps.send_push(PushOut {
                        chat_id: self.chat_id.clone(),
                        title: "Session Error".to_string(),
                        body: "A session ended unexpectedly".to_string(),
                        push_type: "error".to_string(),
                        priority: "high".to_string(),
                    });
                }
            }
        } else if self.deps.notify_task_complete() {
            let last_text = {
                let msgs = self.messages.lock().unwrap_or_else(|e| e.into_inner());
                get_last_assistant_text(msgs.get(&self.chat_id))
            };
            let body = if last_text.is_empty() {
                format!("Session finished (cost: ${cost:.4})")
            } else {
                last_text
            };
            self.deps.emit_event(DaemonEvent::ChatNotification {
                chat_id: self.chat_id.clone(),
                title: "Task Complete".to_string(),
                body: body.clone(),
                level: ChatNotificationLevel::Success,
            });
            self.deps.send_push(PushOut {
                chat_id: self.chat_id.clone(),
                title: "Task Complete".to_string(),
                body,
                push_type: "task_complete".to_string(),
                priority: "default".to_string(),
            });
        }
    }

    fn on_queued_processed(&self, uuid: &str) {
        debug!(
            chat_id = self.chat_id,
            uuid, "onQueuedProcessed: moving queued message to end + clearing flag"
        );
        let found_id = {
            let msgs = self.messages.lock().unwrap_or_else(|e| e.into_inner());
            msgs.get(&self.chat_id).and_then(|v| {
                v.iter()
                    .find(|m| {
                        m.metadata
                            .as_ref()
                            .and_then(|md| md.get("uuid"))
                            .and_then(|v| v.as_str())
                            == Some(uuid)
                    })
                    .map(|m| m.id.clone())
            })
        };
        if let Some(id) = &found_id {
            self.mutate_messages(|v| strip_queued_and_move(v, id));
        }
        if found_id.is_some() {
            self.emit_display();
        } else {
            warn!(
                chat_id = self.chat_id,
                uuid, "onQueuedProcessed: message not found in cache or already processed"
            );
        }
        self.deps.emit_event(DaemonEvent::MessageQueuedProcessed {
            chat_id: self.chat_id.clone(),
            uuid: uuid.to_string(),
        });
        self.deps.on_queued_processed(&self.chat_id, uuid);
    }

    fn on_exit(&self, _code: Option<i32>) {
        let cell = self.deps.get_active_chat(&self.chat_id);
        let session_id = cell.as_ref().and_then(|c| {
            c.lock()
                .unwrap_or_else(|e| e.into_inner())
                .session
                .as_ref()
                .map(|s| s.id().to_string())
        });
        if let Some(built) = &self.built_for_session_id
            && let Some(sid) = &session_id
            && sid != built
        {
            return;
        }
        let session_id = session_id.unwrap_or_default();
        debug!(session_id, chat_id = self.chat_id, "session exited");

        let had_queued = self
            .mutate_messages(|v| {
                let mut had = false;
                for m in v.iter_mut() {
                    if is_queued(m) {
                        if let Some(md) = m.metadata.as_mut() {
                            md.remove("queued");
                            md.remove("uuid");
                        }
                        had = true;
                    }
                }
                had
            })
            .unwrap_or(false);
        if had_queued {
            self.emit_display();
            self.deps.emit_event(DaemonEvent::MessageQueuedCleared {
                chat_id: self.chat_id.clone(),
            });
        }
        self.deps.on_queued_cleared(&self.chat_id);

        // The CLI process owns every live background task (agents, workflows,
        // bg bash) — none can report completion after it dies. Stop them so
        // orphaned entries don't pin the sidebar's working indicator; the
        // tracker emits `ended` per survivor for connected clients.
        self.deps.tracker_end_all_running(&self.chat_id);

        if let Some(cell) = &cell {
            let chat = {
                let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
                guard.chat.process_state = Some(None);
                guard.chat.clone()
            };
            self.deps.chats_update(
                &self.chat_id,
                &EventChatUpdate {
                    process_state: Some(None),
                    ..Default::default()
                },
            );
            self.deps
                .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
        }
        self.deps.emit_event(DaemonEvent::ProcessStopped {
            process_id: session_id,
        });
    }

    fn on_error(&self, error: mainframe_adapter_api::AdapterError) {
        self.deps.emit_event(DaemonEvent::Error {
            chat_id: Some(self.chat_id.clone()),
            error: error.to_string(),
        });
    }

    fn on_compact(&self) {
        let message = self.transient(
            ChatMessageType::System,
            vec![MessageContent::Node(MessageContentNode::Compaction {
                parent_tool_use_id: None,
            })],
            None,
        );
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .append(&self.chat_id, message.clone());
        self.deps.emit_event(DaemonEvent::MessageAdded {
            chat_id: self.chat_id.clone(),
            message,
        });
        self.deps.emit_event(DaemonEvent::ChatCompactDone {
            chat_id: self.chat_id.clone(),
        });
        self.emit_display();
    }

    fn on_compact_start(&self) {
        self.deps.emit_event(DaemonEvent::ChatCompacting {
            chat_id: self.chat_id.clone(),
        });
    }

    fn on_context_usage(&self, usage: ContextUsage) {
        // Persist the CLI's own totals so the meter survives reloads and
        // dormant-chat turns instead of regressing to a catalog-window guess
        // (#197). `chat.updated` is broadcast ungated (unlike chat.contextUsage,
        // which only reaches subscribers), so unsubscribed clients converge too.
        if usage.max_tokens > 0 {
            self.deps.chats_update(
                &self.chat_id,
                &EventChatUpdate {
                    last_context_total_tokens: Some(usage.total_tokens as u64),
                    last_context_max_tokens: Some(usage.max_tokens as u64),
                    ..Default::default()
                },
            );
            if let Some(cell) = self.deps.get_active_chat(&self.chat_id) {
                let chat = {
                    let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
                    guard.chat.last_context_total_tokens = Some(usage.total_tokens as u64);
                    guard.chat.last_context_max_tokens = Some(usage.max_tokens as u64);
                    guard.chat.clone()
                };
                self.deps
                    .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
            }
        }
        self.deps.emit_event(DaemonEvent::ChatContextUsage {
            chat_id: self.chat_id.clone(),
            percentage: usage.percentage,
            total_tokens: usage.total_tokens,
            max_tokens: usage.max_tokens,
        });
    }

    fn on_plan_file(&self, file_path: &str) {
        if self.deps.add_plan_file(&self.chat_id, file_path) {
            self.deps.emit_event(DaemonEvent::ContextUpdated {
                chat_id: self.chat_id.clone(),
                file_paths: None,
            });
        }
    }

    fn on_skill_file(&self, entry: SkillFileEntry) {
        if self.deps.add_skill_file(&self.chat_id, &entry) {
            self.deps.emit_event(DaemonEvent::ContextUpdated {
                chat_id: self.chat_id.clone(),
                file_paths: None,
            });
        }
    }

    fn on_todo_update(&self, todos: Vec<TodoItem>) {
        self.deps.update_todos(&self.chat_id, &todos);
        if let Some(cell) = self.deps.get_active_chat(&self.chat_id) {
            cell.lock().unwrap_or_else(|e| e.into_inner()).chat.todos = Some(todos.clone());
        }
        self.deps.emit_event(DaemonEvent::TodosUpdated {
            chat_id: self.chat_id.clone(),
            todos,
        });
    }

    fn on_pr_detected(&self, pr: DetectedPr) {
        let persisted = self
            .deps
            .add_detected_prs(&self.chat_id, std::slice::from_ref(&pr));
        let Some(first) = persisted.into_iter().next() else {
            return;
        };
        self.deps.emit_event(DaemonEvent::ChatPrDetected {
            chat_id: self.chat_id.clone(),
            pr: first,
        });
    }

    fn on_cli_message(&self, text: &str) {
        let message = self.transient(
            ChatMessageType::System,
            vec![MessageContent::Leaf(LeafContent::Text {
                text: text.to_string(),
                parent_tool_use_id: None,
            })],
            None,
        );
        self.append_and_emit(message);
    }

    fn on_skill_loaded(&self, entry: mainframe_adapter_api::LoadedSkill) {
        let message = self.transient(
            ChatMessageType::System,
            vec![MessageContent::Leaf(LeafContent::SkillLoaded {
                skill_name: entry.skill_name,
                path: entry.path,
                content: entry.content,
                parent_tool_use_id: None,
            })],
            None,
        );
        self.append_and_emit(message);
    }

    fn on_subagent_child(&self, parent_tool_use_id: &str, blocks: Vec<MessageContent>) {
        let has_cache = self
            .messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&self.chat_id)
            .is_some();
        if !has_cache {
            warn!(
                chat_id = self.chat_id,
                parent_tool_use_id,
                block_count = blocks.len(),
                "onSubagentChild: no messages in cache; dropping blocks"
            );
            return;
        }
        let mut blocks = Some(blocks);
        let updated = self.mutate_messages(|v| {
            for i in (0..v.len()).rev() {
                if v[i].r#type != ChatMessageType::Assistant {
                    continue;
                }
                let owns = v[i].content.iter().any(|b| {
                    matches!(b, MessageContent::Node(MessageContentNode::ToolUse { id, .. }) if id == parent_tool_use_id)
                });
                if !owns {
                    continue;
                }
                if let Some(bs) = blocks.take() {
                    v[i].content.extend(bs);
                }
                return Some(v[i].clone());
            }
            None
        });
        match updated {
            Some(Some(message)) => {
                self.deps.emit_event(DaemonEvent::MessageUpdated {
                    chat_id: self.chat_id.clone(),
                    message,
                });
                self.emit_display();
            }
            _ => {
                warn!(
                    chat_id = self.chat_id,
                    parent_tool_use_id,
                    block_count = blocks.map(|b| b.len()).unwrap_or(0),
                    "onSubagentChild: parent tool_use not found in cache; dropping blocks"
                );
            }
        }
    }

    fn on_trust_required(&self, project_path: &str) {
        self.deps.emit_event(DaemonEvent::ChatTrustRequired {
            chat_id: self.chat_id.clone(),
            project_path: project_path.to_string(),
        });
    }

    fn on_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
        self.deps.on_provider_quota(adapter_id, quota);
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_chat;
    use mainframe_services::quota::{IngestMode, QuotaManager};
    use mainframe_types::adapter::MessageUsage;

    /// A fake `EventHandlerDeps` recording emitted events; `get_queued_refs` reads
    /// the mutable `refs` vec so orphan pruning is observable (mirrors the TS test
    /// closure that splices the array).
    struct FakeDeps {
        cell: Arc<Mutex<ActiveChat>>,
        events: Mutex<Vec<DaemonEvent>>,
        refs: Mutex<Vec<QueuedMessageRef>>,
        updates: Mutex<Vec<EventChatUpdate>>,
        quota: Option<Arc<QuotaManager>>,
    }

    impl FakeDeps {
        fn new(cell: Arc<Mutex<ActiveChat>>, refs: Vec<QueuedMessageRef>) -> Arc<Self> {
            Arc::new(Self {
                cell,
                events: Mutex::new(Vec::new()),
                refs: Mutex::new(refs),
                updates: Mutex::new(Vec::new()),
                quota: None,
            })
        }
        fn with_quota(cell: Arc<Mutex<ActiveChat>>, quota: Arc<QuotaManager>) -> Arc<Self> {
            Arc::new(Self {
                cell,
                events: Mutex::new(Vec::new()),
                refs: Mutex::new(Vec::new()),
                updates: Mutex::new(Vec::new()),
                quota: Some(quota),
            })
        }
        fn events(&self) -> Vec<DaemonEvent> {
            self.events.lock().unwrap().clone()
        }
    }

    impl EventHandlerDeps for FakeDeps {
        fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
            Some(self.cell.clone())
        }
        fn emit_event(&self, event: DaemonEvent) {
            self.events.lock().unwrap().push(event);
        }
        fn get_tool_categories(&self, _chat_id: &str) -> Option<ToolCategories> {
            None
        }
        fn on_queued_processed(&self, _chat_id: &str, uuid: &str) {
            self.refs.lock().unwrap().retain(|r| r.uuid != uuid);
        }
        fn on_queued_cleared(&self, _chat_id: &str) {}
        fn get_queued_refs(&self, _chat_id: &str) -> Vec<QueuedMessageRef> {
            self.refs.lock().unwrap().clone()
        }
        fn prepare_messages_for_client(
            &self,
            _raw: &[ChatMessage],
            _categories: Option<&ToolCategories>,
        ) -> Vec<DisplayMessage> {
            Vec::new()
        }
        fn strip_command_tags(&self, text: &str) -> String {
            text.to_string()
        }
        fn chats_update(&self, _chat_id: &str, patch: &EventChatUpdate) {
            self.updates.lock().unwrap().push(patch.clone());
        }
        fn projects_get_path(&self, _project_id: &str) -> Option<String> {
            None
        }
        fn add_plan_file(&self, _chat_id: &str, _file_path: &str) -> bool {
            false
        }
        fn add_skill_file(&self, _chat_id: &str, _entry: &SkillFileEntry) -> bool {
            false
        }
        fn update_todos(&self, _chat_id: &str, _todos: &[TodoItem]) {}
        fn add_detected_prs(&self, _chat_id: &str, _prs: &[DetectedPr]) -> Vec<DetectedPr> {
            Vec::new()
        }
        fn should_notify_permission(&self, _tool_name: Option<&str>) -> bool {
            false
        }
        fn notify_task_complete(&self) -> bool {
            false
        }
        fn notify_session_error(&self) -> bool {
            false
        }
        fn on_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
            // Mirror DaemonChatDeps: session-pushed quota sparse-merges (Push).
            if let Some(q) = &self.quota {
                q.ingest(adapter_id, quota, IngestMode::Push);
            }
        }
    }

    fn umsg(id: &str, meta: Option<HashMap<String, serde_json::Value>>) -> ChatMessage {
        ChatMessage {
            id: id.to_string(),
            chat_id: "c1".to_string(),
            r#type: ChatMessageType::User,
            content: vec![MessageContent::Leaf(LeafContent::Text {
                text: id.to_string(),
                parent_tool_use_id: None,
            })],
            timestamp: now_iso8601(),
            metadata: meta,
        }
    }

    fn queued_meta(uuid: &str) -> HashMap<String, serde_json::Value> {
        let mut m = HashMap::new();
        m.insert("queued".to_string(), serde_json::json!(true));
        m.insert("uuid".to_string(), serde_json::json!(uuid));
        m
    }

    fn cell(process_state: ProcessState, turn_started_at: Option<i64>) -> Arc<Mutex<ActiveChat>> {
        let mut chat = test_chat("c1");
        chat.process_state = Some(Some(process_state));
        Arc::new(Mutex::new(ActiveChat {
            chat,
            session: None,
            turn_started_at,
        }))
    }

    fn ids(messages: &Arc<Mutex<MessageCache>>) -> Vec<String> {
        messages
            .lock()
            .unwrap()
            .get("c1")
            .map(|v| v.iter().map(|m| m.id.clone()).collect())
            .unwrap_or_default()
    }

    // ── event-handler-session-path.test.ts ──────────────────────────────────
    #[test]
    fn encodes_cwd_the_claude_way_and_points_at_the_jsonl() {
        let home = dirs::home_dir().unwrap();
        let expected = home
            .join(".claude")
            .join("projects")
            .join("-Users-x-proj")
            .join("sess-abc.jsonl")
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            compute_session_file_path("/Users/x/proj", "sess-abc"),
            expected
        );
    }

    #[test]
    fn encodes_non_alphanumerics_to_dashes() {
        let home = dirs::home_dir().unwrap();
        let expected = home
            .join(".claude")
            .join("projects")
            .join("-a-b-c-worktrees-x")
            .join("sid.jsonl")
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            compute_session_file_path("/a/b.c/worktrees/x", "sid"),
            expected
        );
    }

    #[test]
    fn sanitizes_a_malicious_session_id_so_it_cannot_traverse() {
        let p = compute_session_file_path("/proj", "../../etc/passwd");
        assert!(!p.contains(".."));
        assert!(p.ends_with(".jsonl"));
    }

    // ── event-handler-move-on-process.test.ts (ack path) ─────────────────────
    #[test]
    fn moves_the_acked_message_to_the_end_strips_metadata_and_deletes_the_ref() {
        let messages = Arc::new(Mutex::new(MessageCache::new()));
        messages
            .lock()
            .unwrap()
            .append("c1", umsg("q", Some(queued_meta("u1"))));
        messages
            .lock()
            .unwrap()
            .append("c1", umsg("assistant-reply", None));
        let refs = vec![QueuedMessageRef {
            message_id: "q".to_string(),
            chat_id: "c1".to_string(),
            uuid: "u1".to_string(),
            content: "q".to_string(),
            attachment_ids: None,
            timestamp: String::new(),
        }];
        let deps = FakeDeps::new(cell(ProcessState::Working, None), refs);
        let handler = EventHandler::new(
            messages.clone(),
            Arc::new(Mutex::new(PermissionManager::new())),
            deps.clone(),
        );
        let sink = handler.build_sink("c1", None);

        sink.on_queued_processed("u1");

        assert_eq!(ids(&messages), vec!["assistant-reply", "q"]);
        let moved = messages.lock().unwrap();
        let m = moved
            .get("c1")
            .unwrap()
            .iter()
            .find(|m| m.id == "q")
            .unwrap()
            .clone();
        drop(moved);
        assert!(
            m.metadata
                .as_ref()
                .and_then(|md| md.get("queued"))
                .is_none()
        );
        assert!(m.metadata.as_ref().and_then(|md| md.get("uuid")).is_none());
        assert_eq!(deps.refs.lock().unwrap().len(), 0);
        assert!(deps.events().iter().any(
            |e| matches!(e, DaemonEvent::MessageQueuedProcessed { uuid, .. } if uuid == "u1")
        ));
    }

    // ── session-pushed provider quota (Codex account/rateLimits/updated) ──────
    // Seam-3: a `sink.on_provider_quota` emission from a live session event must
    // reach the real QuotaManager, sparse-merge (Push keeps the prior weekly
    // window a partial blob omits), and fan out `provider.quota.updated`.
    #[test]
    fn sink_provider_quota_sparse_merges_into_the_quota_manager_and_fans_out() {
        use mainframe_services::quota::{QuotaManagerDeps, QuotaSettingsStore};
        use mainframe_types::adapter::{ProviderQuotaStatus, QuotaWindow, QuotaWindowKind};
        use std::collections::HashMap as StdHashMap;

        const NOW: i64 = 1_700_000_000_000;

        #[derive(Clone, Default)]
        struct MapSettings {
            store: Arc<Mutex<StdHashMap<String, String>>>,
        }
        impl QuotaSettingsStore for MapSettings {
            fn get(&self, category: &str, key: &str) -> Option<String> {
                self.store
                    .lock()
                    .unwrap()
                    .get(&format!("{category} {key}"))
                    .cloned()
            }
            fn get_by_category(&self, category: &str) -> StdHashMap<String, String> {
                let mut out = StdHashMap::new();
                for (k, v) in self.store.lock().unwrap().iter() {
                    if let Some((cat, key)) = k.split_once(' ')
                        && cat == category
                    {
                        out.insert(key.to_string(), v.clone());
                    }
                }
                out
            }
            fn set(&self, category: &str, key: &str, value: &str) {
                self.store
                    .lock()
                    .unwrap()
                    .insert(format!("{category} {key}"), value.to_string());
            }
        }

        let window = |kind, used| QuotaWindow {
            kind,
            used_percent: used,
            resets_at: Some(NOW + 3 * 60 * 60 * 1000),
            observed_at: Some(NOW),
            label: None,
        };
        let full = |session, weekly| ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            observed_at: NOW,
            model_windows: vec![],
            session,
            weekly,
            account_identity: Some("acct-1".into()),
        };

        let quota_events = Arc::new(Mutex::new(Vec::<DaemonEvent>::new()));
        let quota_events_emit = Arc::clone(&quota_events);
        let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
            settings: Box::new(MapSettings::default()),
            emit_event: Box::new(move |e| quota_events_emit.lock().unwrap().push(e)),
            now: Some(Box::new(|| NOW)),
        }));

        // Seed a prior full blob (as a pull would) so the sparse push has a weekly
        // window to retain.
        quota.ingest(
            "codex",
            full(
                Some(window(QuotaWindowKind::Session, 20.0)),
                Some(window(QuotaWindowKind::Weekly, 55.0)),
            ),
            IngestMode::Pull,
        );

        let deps = FakeDeps::with_quota(cell(ProcessState::Working, None), Arc::clone(&quota));
        let handler = EventHandler::new(
            Arc::new(Mutex::new(MessageCache::new())),
            Arc::new(Mutex::new(PermissionManager::new())),
            deps,
        );
        let sink = handler.build_sink("c1", None);

        // The live session path: Codex pushes a session-only partial (weekly omitted).
        sink.on_provider_quota(
            "codex",
            full(Some(window(QuotaWindowKind::Session, 80.0)), None),
        );

        let merged = quota.get("codex").expect("quota persisted for codex");
        assert_eq!(merged.session.as_ref().unwrap().used_percent, 80.0);
        assert_eq!(
            merged.weekly.as_ref().unwrap().used_percent,
            55.0,
            "sparse Push retains the prior weekly window the partial omitted"
        );

        let events = quota_events.lock().unwrap();
        assert_eq!(
            events.len(),
            2,
            "one fan-out for the seed pull, one for the push"
        );
        match &events[1] {
            DaemonEvent::ProviderQuotaUpdated { adapter_id, quota } => {
                assert_eq!(adapter_id, "codex");
                assert_eq!(quota.session.as_ref().unwrap().used_percent, 80.0);
                assert_eq!(quota.weekly.as_ref().unwrap().used_percent, 55.0);
            }
            other => panic!("expected provider.quota.updated, got {other:?}"),
        }
    }

    // ── onResult orphan-reconcile path ───────────────────────────────────────
    #[test]
    fn moves_an_orphan_queued_message_to_the_end_and_goes_idle() {
        let messages = Arc::new(Mutex::new(MessageCache::new()));
        messages
            .lock()
            .unwrap()
            .append("c1", umsg("q", Some(queued_meta("u1"))));
        messages
            .lock()
            .unwrap()
            .append("c1", umsg("assistant-reply", None));
        let cell = cell(ProcessState::Working, None);
        let deps = FakeDeps::new(cell.clone(), Vec::new());
        let handler = EventHandler::new(
            messages.clone(),
            Arc::new(Mutex::new(PermissionManager::new())),
            deps.clone(),
        );
        let sink = handler.build_sink("c1", None);

        sink.on_result(SessionResult {
            total_cost_usd: Some(0.0),
            usage: None,
            context_tokens: None,
            subtype: Some("success".to_string()),
            result: None,
            is_error: Some(false),
        });

        assert_eq!(ids(&messages), vec!["assistant-reply", "q"]);
        let m = messages.lock().unwrap();
        let q = m
            .get("c1")
            .unwrap()
            .iter()
            .find(|m| m.id == "q")
            .unwrap()
            .clone();
        drop(m);
        assert!(
            q.metadata
                .as_ref()
                .and_then(|md| md.get("queued"))
                .is_none()
        );
        assert_eq!(
            cell.lock().unwrap().chat.process_state,
            Some(Some(ProcessState::Idle))
        );
    }

    #[test]
    fn moves_all_orphan_queued_messages_to_the_end() {
        let messages = Arc::new(Mutex::new(MessageCache::new()));
        messages
            .lock()
            .unwrap()
            .append("c1", umsg("q1", Some(queued_meta("u1"))));
        messages
            .lock()
            .unwrap()
            .append("c1", umsg("q2", Some(queued_meta("u2"))));
        messages
            .lock()
            .unwrap()
            .append("c1", umsg("assistant-reply", None));
        let deps = FakeDeps::new(cell(ProcessState::Working, None), Vec::new());
        let handler = EventHandler::new(
            messages.clone(),
            Arc::new(Mutex::new(PermissionManager::new())),
            deps.clone(),
        );
        let sink = handler.build_sink("c1", None);

        sink.on_result(SessionResult {
            total_cost_usd: Some(0.0),
            usage: None,
            context_tokens: None,
            subtype: Some("success".to_string()),
            result: None,
            is_error: Some(false),
        });

        assert_eq!(ids(&messages), vec!["assistant-reply", "q1", "q2"]);
        let m = messages.lock().unwrap();
        let q2 = m
            .get("c1")
            .unwrap()
            .iter()
            .find(|m| m.id == "q2")
            .unwrap()
            .clone();
        drop(m);
        assert!(
            q2.metadata
                .as_ref()
                .and_then(|md| md.get("queued"))
                .is_none()
        );
        let processed: Vec<String> = deps
            .events()
            .iter()
            .filter_map(|e| match e {
                DaemonEvent::MessageQueuedProcessed { uuid, .. } => Some(uuid.clone()),
                _ => None,
            })
            .collect();
        assert!(processed.contains(&"u1".to_string()));
        assert!(processed.contains(&"u2".to_string()));
    }

    // ── event-handler-turn-timing.test.ts ────────────────────────────────────
    #[test]
    fn emits_a_transient_system_message_carrying_turn_duration_ms() {
        let started_at = now_ms() - 1500;
        let messages = Arc::new(Mutex::new(MessageCache::new()));
        let deps = FakeDeps::new(cell(ProcessState::Working, Some(started_at)), Vec::new());
        let handler = EventHandler::new(
            messages.clone(),
            Arc::new(Mutex::new(PermissionManager::new())),
            deps.clone(),
        );
        let sink = handler.build_sink("chat-timing", None);

        sink.on_result(SessionResult {
            total_cost_usd: Some(0.01),
            usage: Some(MessageUsage {
                input_tokens: Some(10),
                output_tokens: Some(5),
                cache_creation_input_tokens: None,
                cache_read_input_tokens: None,
            }),
            context_tokens: None,
            subtype: None,
            result: None,
            is_error: None,
        });

        let timing = deps.events().into_iter().find_map(|e| match e {
            DaemonEvent::MessageAdded { message, .. }
                if message.r#type == ChatMessageType::System
                    && message
                        .metadata
                        .as_ref()
                        .and_then(|md| md.get("turnDurationMs"))
                        .is_some() =>
            {
                message
                    .metadata
                    .as_ref()
                    .and_then(|md| md.get("turnDurationMs"))
                    .and_then(|v| v.as_i64())
            }
            _ => None,
        });
        // measured from turnStartedAt (now - 1500) → ~1500ms; allow slack for wall time.
        let ms = timing.expect("turn timing message");
        assert!((1500..1700).contains(&ms), "turnDurationMs was {ms}");
    }

    #[test]
    fn does_not_emit_turn_timing_when_turn_started_at_was_never_stamped() {
        let messages = Arc::new(Mutex::new(MessageCache::new()));
        let deps = FakeDeps::new(cell(ProcessState::Working, None), Vec::new());
        let handler = EventHandler::new(
            messages,
            Arc::new(Mutex::new(PermissionManager::new())),
            deps.clone(),
        );
        let sink = handler.build_sink("chat-timing", None);

        sink.on_result(SessionResult {
            total_cost_usd: Some(0.0),
            usage: Some(MessageUsage {
                input_tokens: Some(0),
                output_tokens: Some(0),
                cache_creation_input_tokens: None,
                cache_read_input_tokens: None,
            }),
            context_tokens: None,
            subtype: None,
            result: None,
            is_error: None,
        });

        let has_timing = deps.events().iter().any(|e| {
            matches!(e, DaemonEvent::MessageAdded { message, .. }
                if message.r#type == ChatMessageType::System
                && message.metadata.as_ref().and_then(|md| md.get("turnDurationMs")).is_some())
        });
        assert!(!has_timing);
    }

    // ── event-handler-background-activity.test.ts ────────────────────────────
    use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskSeed};
    use mainframe_types::background_task::{
        BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind,
    };

    struct BgDeps {
        cell: Arc<Mutex<ActiveChat>>,
        tracker: Arc<BackgroundTaskTracker>,
        events: Mutex<Vec<DaemonEvent>>,
        updates: Mutex<Vec<EventChatUpdate>>,
    }
    impl BgDeps {
        fn new(cell: Arc<Mutex<ActiveChat>>, tracker: Arc<BackgroundTaskTracker>) -> Arc<Self> {
            Arc::new(Self {
                cell,
                tracker,
                events: Mutex::new(Vec::new()),
                updates: Mutex::new(Vec::new()),
            })
        }
    }
    impl EventHandlerDeps for BgDeps {
        fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
            Some(self.cell.clone())
        }
        fn emit_event(&self, event: DaemonEvent) {
            self.events.lock().unwrap().push(event);
        }
        fn get_tool_categories(&self, _chat_id: &str) -> Option<ToolCategories> {
            None
        }
        fn on_queued_processed(&self, _chat_id: &str, _uuid: &str) {}
        fn on_queued_cleared(&self, _chat_id: &str) {}
        fn get_queued_refs(&self, _chat_id: &str) -> Vec<QueuedMessageRef> {
            Vec::new()
        }
        fn prepare_messages_for_client(
            &self,
            _raw: &[ChatMessage],
            _categories: Option<&ToolCategories>,
        ) -> Vec<DisplayMessage> {
            Vec::new()
        }
        fn strip_command_tags(&self, text: &str) -> String {
            text.to_string()
        }
        fn chats_update(&self, _chat_id: &str, patch: &EventChatUpdate) {
            self.updates.lock().unwrap().push(patch.clone());
        }
        fn projects_get_path(&self, _project_id: &str) -> Option<String> {
            None
        }
        fn add_plan_file(&self, _chat_id: &str, _file_path: &str) -> bool {
            false
        }
        fn add_skill_file(&self, _chat_id: &str, _entry: &SkillFileEntry) -> bool {
            false
        }
        fn update_todos(&self, _chat_id: &str, _todos: &[TodoItem]) {}
        fn add_detected_prs(&self, _chat_id: &str, _prs: &[DetectedPr]) -> Vec<DetectedPr> {
            Vec::new()
        }
        fn should_notify_permission(&self, _tool_name: Option<&str>) -> bool {
            false
        }
        fn notify_task_complete(&self) -> bool {
            false
        }
        fn notify_session_error(&self) -> bool {
            false
        }
        fn tracker_end_all_running(&self, chat_id: &str) {
            self.tracker.end_all_running(chat_id);
        }
    }

    fn bg_sink(deps: Arc<BgDeps>) -> Arc<dyn SessionSink> {
        let handler = EventHandler::new(
            Arc::new(Mutex::new(MessageCache::new())),
            Arc::new(Mutex::new(PermissionManager::new())),
            deps,
        );
        handler.build_sink("chat-bg", None)
    }

    fn seed(id: &str, kind: BackgroundWorkKind, command: &str, description: &str) -> TaskSeed {
        TaskSeed {
            id: id.to_string(),
            kind,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: format!("tu-{id}"),
            command: command.to_string(),
            description: description.to_string(),
        }
    }

    #[test]
    fn on_exit_stops_every_running_task() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        tracker.start(
            "chat-bg",
            seed("a-1", BackgroundWorkKind::Agent, "", "agent"),
            "/p/a-1".to_string(),
        );
        tracker.start(
            "chat-bg",
            seed("b-1", BackgroundWorkKind::Bash, "dev", ""),
            "/p/b-1".to_string(),
        );
        let deps = BgDeps::new(cell(ProcessState::Working, None), tracker.clone());

        bg_sink(deps).on_exit(Some(0));

        assert!(tracker.list_live("chat-bg").is_empty());
        assert_eq!(
            tracker.get("chat-bg", "a-1").unwrap().status,
            BackgroundTaskStatus::Stopped
        );
        assert_eq!(
            tracker.get("chat-bg", "b-1").unwrap().status,
            BackgroundTaskStatus::Stopped
        );
    }

    #[test]
    fn on_exit_does_not_touch_other_chats() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        tracker.start(
            "other-chat",
            seed("x-1", BackgroundWorkKind::Bash, "c", ""),
            "/p/x-1".to_string(),
        );
        let deps = BgDeps::new(cell(ProcessState::Working, None), tracker.clone());

        bg_sink(deps).on_exit(Some(0));

        assert_eq!(tracker.list_live("other-chat").len(), 1);
    }

    #[test]
    fn on_message_drain_turn_flips_idle_back_to_working() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let cell = cell(ProcessState::Idle, None);
        let deps = BgDeps::new(cell.clone(), tracker);

        let text = MessageContent::Leaf(LeafContent::Text {
            text: "drain-turn summary".to_string(),
            parent_tool_use_id: None,
        });
        bg_sink(deps.clone()).on_message(vec![text], None);

        assert_eq!(
            cell.lock().unwrap().chat.process_state,
            Some(Some(ProcessState::Working))
        );
        assert!(
            deps.updates
                .lock()
                .unwrap()
                .iter()
                .any(|u| { u.process_state == Some(Some(ProcessState::Working)) })
        );
        assert!(deps.events.lock().unwrap().iter().any(|e| matches!(
            e,
            DaemonEvent::ChatUpdated { chat, .. } if chat.process_state == Some(Some(ProcessState::Working))
        )));
    }

    #[test]
    fn on_message_does_not_reflip_when_already_working() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let cell = cell(ProcessState::Working, None);
        let deps = BgDeps::new(cell, tracker);

        let text = MessageContent::Leaf(LeafContent::Text {
            text: "mid-turn message".to_string(),
            parent_tool_use_id: None,
        });
        bg_sink(deps.clone()).on_message(vec![text], None);

        assert!(
            !deps
                .events
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, DaemonEvent::ChatUpdated { .. }))
        );
        assert!(
            !deps
                .updates
                .lock()
                .unwrap()
                .iter()
                .any(|u| { u.process_state == Some(Some(ProcessState::Working)) })
        );
    }
}

// PORT STATUS: src/chat/event-handler.ts (577 lines)
// confidence: medium
// notes: The `EventHandler` constructor callback bag → `EventHandlerDeps` trait;
// notes: `messages`/`permissions` are shared `Arc<Mutex<..>>` (the session reader
// notes: task drives the sink from another task, so the PER_ENTITY caches need a
// notes: lock — CONCURRENCY.tsv rule 1/3). `displayCache` stays owned by the handler
// notes: (`Arc<Mutex<HashMap>>`). The sink's `pendingFilePaths`/`pendingSubagentIds`
// notes: are SINGLE_TASK but need interior mutability under `&self` SessionSink →
// notes: `Mutex` (uncontended). `stripMainframeCommandTags` + `prepareMessagesForClient`
// notes: are Claude-specific (adapter-claude) → injected via deps to avoid a cycle.
// notes: `pushService`/notification config collapse into deps methods. onResult
// notes: reconcile snapshots message ids before move_to_end (mirrors the TS
// notes: `[...cached]` copy). buildSink drops the unused `_respondToPermission`.
// notes: Main catch-up (#423/#424/#425): onResult context-tokens is a two-way
// notes: branch — `data.context_tokens.filter(|v| v>0)` (None keeps the stored size).
// notes: Option<i64> can't carry the TS undefined/null distinction, so each adapter
// notes: resolves its context value at its own boundary: claude sends the last
// notes: parent assistant usage (or None); codex sends this turn's raw input usage
// notes: to mirror the TS `undefined→usage` fallback. onContextUsage persists
// notes: lastContextTotal/MaxTokens +
// notes: broadcasts chat.updated ungated. onExit calls tracker_end_all_running (new
// notes: defaulted deps method) BEFORE clearing processState. onMessage drain-turn
// notes: re-entry flips a non-working processState back to working + emits chat.updated
// notes: (snapshot-under-lock, emit-after-drop per CONCURRENCY.tsv rule 3).
// notes: Ported: session-path (3), move-on-process (3), turn-timing (2),
// notes: background-activity (4) test cases.
// todos: 0
