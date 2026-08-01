//! Free helpers shared across the facade and the sub-manager Deps wrappers.
use super::*;

pub(super) fn is_working(chat: &Chat) -> bool {
    chat.process_state == Some(Some(ProcessState::Working))
}

/// `enrichChat` — set displayStatus/isRunning/backgroundActivity/directory signals.
/// Mutates in place. `live_tasks` is `tracker.listLive(chat.id)`.
pub(super) fn enrich_chat(
    chat: &mut Chat,
    has_pending: bool,
    live_tasks: &[BackgroundTask],
    project_path: Option<&str>,
) {
    let working = is_working(chat);
    // Live background work broadens the sidebar 'working' state, but never
    // isRunning — the composer/thread indicator stays main-turn-only.
    chat.display_status = Some(if has_pending {
        DisplayStatus::Waiting
    } else if working || !live_tasks.is_empty() {
        DisplayStatus::Working
    } else {
        DisplayStatus::Idle
    });
    chat.is_running = Some(working && !has_pending);
    let activity_tasks: Vec<_> = live_tasks.iter().map(to_activity_task).collect();
    chat.background_activity = derive_background_activity(&activity_tasks);
    chat.worktree_missing = Some(
        chat.worktree_path
            .as_ref()
            .map(|p| !is_worktree_present(p))
            .unwrap_or(false),
    );
    let missing_path = match chat.worktree_path.as_deref() {
        Some(path) if !is_worktree_present(path) => Some(path),
        Some(_) => None,
        None => project_path.filter(|path| !is_directory_present(path)),
    };
    chat.directory_missing = Some(missing_path.is_some());
    chat.missing_directory_path = missing_path.map(str::to_string);
}

/// Enrich chat.updated/chat.created then emit through the raw `onEvent`.
pub(super) fn enrich_and_emit(
    deps: &dyn ChatManagerDeps,
    permissions: &Arc<Mutex<PermissionManager>>,
    mut event: DaemonEvent,
) {
    match &mut event {
        DaemonEvent::ChatUpdated { chat, .. } | DaemonEvent::ChatCreated { chat, .. } => {
            let has_pending = permissions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .has_pending(&chat.id);
            let live = deps.tracker_list_live(&chat.id);
            let project_path = deps.projects_get_path(&chat.project_id);
            enrich_chat(chat, has_pending, &live, project_path.as_deref());
        }
        _ => {}
    }
    deps.emit_event(event);
}

/// `ChatManager.applyTuning` — live-apply resolved tuning to the running session.
/// Shared by the facade method and the config manager's `apply_tuning` dep (a model
/// switch re-resolves + re-applies). No live session → applied at next spawn.
pub(super) async fn apply_tuning_impl(
    active_chats: &Registry,
    deps: &Arc<dyn ChatManagerDeps>,
    chat_id: &str,
) {
    let session = active_chats
        .get(chat_id)
        .and_then(|c| c.lock().unwrap_or_else(|e| e.into_inner()).session.clone());
    let Some(session) = session else {
        return;
    };
    let Some(resolved) = deps.resolve_tuning(chat_id).await else {
        return;
    };
    if let Err(err) = session.apply_tuning(resolved).await {
        tracing::warn!(?err, chat_id, "live applyTuning failed");
    }
}

// ── queued-ref helpers (shared by the facade + EhDeps) ───────────────────────

pub(super) fn queued_for_chat(refs: &QueuedRefs, chat_id: &str) -> Vec<QueuedMessageRef> {
    refs.lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .filter(|r| r.chat_id == chat_id)
        .cloned()
        .collect()
}

pub(super) fn handle_queued_processed(refs: &QueuedRefs, chat_id: &str, uuid: &str) {
    let removed = refs.lock().unwrap_or_else(|e| e.into_inner()).remove(uuid);
    if let Some(r) = removed {
        info!(
            chat_id,
            uuid,
            message_id = r.message_id,
            "CLI processed queued message"
        );
    }
}

pub(super) fn clear_all_queued_for_chat(refs: &QueuedRefs, chat_id: &str) {
    let mut guard = refs.lock().unwrap_or_else(|e| e.into_inner());
    let before = guard.len();
    guard.retain(|_, r| r.chat_id != chat_id);
    let removed = before - guard.len();
    drop(guard);
    if removed > 0 {
        info!(chat_id, removed, "cleared queued refs for exited chat");
    }
}

/// Build a stateless history-load session for `chat` (shared by the facade's
/// `get_messages`/`get_messages_from_disk` and the permission handler's history
/// restore). `None` when the chat has no Claude session / adapter / project.
pub(super) fn build_history_session(
    deps: &Arc<dyn ChatManagerDeps>,
    chat: &Chat,
    chat_id: &str,
) -> Option<Arc<dyn AdapterSession>> {
    let session_id = chat.claude_session_id.clone()?;
    let project_path = deps.projects_get_path(&chat.project_id)?;
    let cwd = chat.worktree_path.clone().unwrap_or(project_path);
    deps.create_session(
        &chat.adapter_id,
        SessionOptions {
            project_path: cwd,
            chat_id: Some(session_id),
            mainframe_chat_id: chat_id.to_string(),
        },
    )
}

/// `loadHistory` embeds the Claude sessionId as `chatId`; remap it back to the
/// Mainframe chatId before caching/returning.
pub(super) fn remap_history(history: Vec<ChatMessage>, chat_id: &str) -> Vec<ChatMessage> {
    history
        .into_iter()
        .map(|mut m| {
            m.chat_id = chat_id.to_string();
            m
        })
        .collect()
}

pub(super) fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
