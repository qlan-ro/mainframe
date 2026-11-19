//! Helpers shared by the chat facade and its managers.
use super::*;
use mainframe_types::sync::LockExt as _;

pub(super) fn is_working(chat: &Chat) -> bool {
    chat.process_state == Some(Some(ProcessState::Working))
}

/// `enrichChat` — set displayStatus/isRunning/backgroundActivity/directory signals.
/// Mutates in place. `live_tasks` is `tracker.listLive(chat.id)`. `side_chat_waiting`
/// is `permissions.has_pending(side_id)` when this chat has a side chat, else `None`
/// — `display_status`/`is_running` stay this chat's own so the fork-availability gate
/// (which reads `hasPending`) is unaffected.
pub(super) fn enrich_chat(
    chat: &mut Chat,
    has_pending: bool,
    live_tasks: &[BackgroundTask],
    project_path: Option<&str>,
    side_chat_waiting: Option<bool>,
) {
    let working = is_working(chat);
    // Live background work broadens the sidebar 'working' state, but never
    // isRunning — the composer/thread indicator stays main-turn-only.
    chat.display_status = Some(if has_pending {
        DisplayStatus::Waiting
    } else if working || !live_tasks.is_empty() || chat.orchestration.has_running_delegated_task {
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
    chat.side_chat_waiting = side_chat_waiting;
}

/// `ChatManager.applyTuning` — live-apply resolved tuning to the running session.
/// Shared by the facade method and the config manager's `apply_tuning` dep (a model
/// switch re-resolves + re-applies). No live session → applied at next spawn.
pub(crate) async fn apply_tuning_impl(
    active_chats: &Registry,
    deps: &Arc<dyn ChatManagerDeps>,
    chat_id: &str,
) {
    let session = active_chats
        .get(chat_id)
        .and_then(|c| c.lock_recover().session.clone());
    let Some(session) = session else {
        return;
    };
    let Some(resolved) = deps.resolve_tuning(chat_id).await else {
        return;
    };
    if let Err(err) = session.apply_tuning(resolved).await {
        tracing::warn!(error = ?err, chat_id, "live applyTuning failed");
    }
}

/// Composes a multi-segment chat's history; `None` for a single-segment chat
/// (or a deps impl without segments), whose one session loads as before.
pub(crate) async fn compose_if_multi(
    deps: &dyn ChatManagerDeps,
    chat_id: &str,
) -> Option<crate::segments::compose::Composed> {
    let store = deps.segment_store()?;
    let layout = store
        .layout(chat_id)
        .filter(mainframe_types::segment::SegmentLayout::is_multi_segment)?;
    let chat = match deps.chats_get(chat_id) {
        Ok(chat) => chat?,
        Err(error) => {
            tracing::error!(%error, chat_id, "history storage read failed");
            deps.emit_event(DaemonEvent::Error {
                chat_id: Some(chat_id.into()),
                error: error.to_string(),
            });
            return None;
        }
    };
    Some(crate::segments::compose::compose(deps, &chat, &layout).await)
}

// Unsent forks use their persisted source because they have no provider session yet.
pub(crate) fn build_history_session(
    deps: &Arc<dyn ChatManagerDeps>,
    chat: &Chat,
    chat_id: &str,
) -> Option<Arc<dyn AdapterSession>> {
    let own_id = chat.vendor_session_id.clone();
    let fork_source = match deps.get_pending_fork(chat_id) {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, chat_id, "pending fork read failed");
            deps.emit_event(DaemonEvent::Error {
                chat_id: Some(chat_id.into()),
                error: error.to_string(),
            });
            return None;
        }
    }
    .map(|p| p.fork_source);
    if own_id.is_none() && fork_source.is_none() {
        return None;
    }
    let cwd = crate::chat_cwd::chat_cwd(
        chat.worktree_path.as_deref(),
        chat.scratch_path.as_deref(),
        deps.projects_get_path(&chat.project_id),
    )?;
    deps.create_session(
        &chat.adapter_id,
        SessionOptions {
            project_path: cwd,
            chat_id: own_id,
            mainframe_chat_id: chat_id.to_string(),
            session_file_path: chat.session_file_path.clone(),
            fork_source,
        },
    )
}

/// `loadHistory` embeds the Claude sessionId as `chatId`; remap it back to the
/// Mainframe chatId before caching/returning.
pub(crate) fn remap_history(history: Vec<ChatMessage>, chat_id: &str) -> Vec<ChatMessage> {
    history
        .into_iter()
        .map(|mut m| {
            m.chat_id = chat_id.to_string();
            m
        })
        .collect()
}

pub(super) use mainframe_types::time::now_ms;

#[cfg(test)]
#[path = "shared_history_tests.rs"]
mod history_tests;
