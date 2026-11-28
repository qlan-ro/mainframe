//! Multi-segment history: one load per native session, each transcript split
//! back into its segments by marker, dividers between segments, assembled in
//! ordinal order. Single-segment chats never come here (the legacy
//! single-session load stays their path).

use std::collections::HashMap;

use mainframe_types::adapter::SessionOptions;
use mainframe_types::chat::{Chat, ChatMessage};
use mainframe_types::segment::{NativeSessionRecord, SegmentLayout, SegmentRecord};

use super::divider::divider_for;
use super::partition::{bound, partition};
use crate::chat_manager::ChatManagerDeps;

/// The composed history and where the active segment's slice starts — the
/// only slice a dangling permission may be restored from.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Composed {
    pub messages: Vec<ChatMessage>,
    pub active_from: usize,
    /// A transcript the layout needs failed to load and is missing here.
    pub incomplete: bool,
}

pub async fn compose(deps: &dyn ChatManagerDeps, chat: &Chat, layout: &SegmentLayout) -> Composed {
    let (loaded, complete) = load_natives(deps, chat, layout).await;
    let name_of = |adapter_id: &str| deps.adapter_fork_info(adapter_id).name;
    Composed {
        incomplete: !complete,
        ..assemble(&chat.id, layout, loaded, &name_of)
    }
}

/// [`compose`], or `None` when any transcript the layout needs failed to
/// load: a restore must not install a history with a segment missing.
pub async fn compose_complete(
    deps: &dyn ChatManagerDeps,
    chat: &Chat,
    layout: &SegmentLayout,
) -> Option<Composed> {
    let (loaded, complete) = load_natives(deps, chat, layout).await;
    let name_of = |adapter_id: &str| deps.adapter_fork_info(adapter_id).name;
    complete.then(|| assemble(&chat.id, layout, loaded, &name_of))
}

/// Native rows in first-use order, each once.
fn natives_in_use(layout: &SegmentLayout) -> Vec<&NativeSessionRecord> {
    let mut out: Vec<&NativeSessionRecord> = Vec::new();
    for segment in &layout.segments {
        if let Some(native) = layout.native(&segment.native_session_ref)
            && !out.iter().any(|n| n.id == native.id)
        {
            out.push(native);
        }
    }
    out
}

async fn load_natives(
    deps: &dyn ChatManagerDeps,
    chat: &Chat,
    layout: &SegmentLayout,
) -> (HashMap<String, Vec<ChatMessage>>, bool) {
    let mut loaded = HashMap::new();
    let Some(cwd) = native_cwd(deps, chat) else {
        return (loaded, false);
    };
    let active_native = layout.active().map(|s| s.native_session_ref.clone());
    let mut complete = true;
    for native in natives_in_use(layout) {
        let is_active = active_native.as_deref() == Some(native.id.as_str());
        let fork_source = if is_active {
            match deps.get_pending_fork(&chat.id) {
                Ok(pending) => pending.map(|p| p.fork_source),
                Err(error) => {
                    tracing::error!(%error, chat_id = %chat.id, "pending fork read failed");
                    deps.emit_event(mainframe_types::events::DaemonEvent::Error {
                        chat_id: Some(chat.id.clone()),
                        error: error.to_string(),
                    });
                    return (loaded, false);
                }
            }
        } else {
            None
        };
        if native.native_session_id.is_none() && fork_source.is_none() {
            continue;
        }
        let options = SessionOptions {
            project_path: cwd.clone(),
            chat_id: native.native_session_id.clone(),
            mainframe_chat_id: chat.id.clone(),
            session_file_path: native.session_file_path.clone(),
            fork_source,
        };
        match load_native(deps, chat, native, options).await {
            Some(history) => {
                loaded.insert(native.id.clone(), history);
            }
            None => complete = false,
        }
    }
    (loaded, complete)
}

/// One native transcript, remapped; `None` when it could not be read (no
/// session for it, a failed read, or a failure the adapter reported as empty).
async fn load_native(
    deps: &dyn ChatManagerDeps,
    chat: &Chat,
    native: &NativeSessionRecord,
    options: SessionOptions,
) -> Option<Vec<ChatMessage>> {
    let session = deps.create_history_session(&native.adapter_id, options)?;
    match session.load_history().await {
        Ok(_) if session.last_history_read_failed() => {
            tracing::warn!(chat_id = %chat.id, native = %native.id, "segment history read failed");
            None
        }
        Ok(history) => Some(crate::chat_manager::remap_history_for(history, &chat.id)),
        Err(err) => {
            tracing::warn!(error = ?err, chat_id = %chat.id, native = %native.id, "segment history load failed");
            None
        }
    }
}

/// Pure assembly over already-loaded transcripts (keyed by native row id).
pub fn assemble(
    chat_id: &str,
    layout: &SegmentLayout,
    mut loaded: HashMap<String, Vec<ChatMessage>>,
    name_of: &dyn Fn(&str) -> String,
) -> Composed {
    let mut slices: HashMap<String, Vec<ChatMessage>> = HashMap::new();
    for native in natives_in_use(layout) {
        let on_native: Vec<&SegmentRecord> = layout
            .segments
            .iter()
            .filter(|s| s.native_session_ref == native.id)
            .collect();
        let messages = loaded.remove(&native.id).unwrap_or_default();
        for (segment_id, slice) in partition(messages, &on_native) {
            let slice = match on_native.iter().find(|s| s.id == segment_id) {
                Some(s) if native.borrowed_from_chat_id.is_some() => bound(
                    slice,
                    s.end_bound_message_id.as_deref(),
                    s.end_bound_at.as_deref(),
                ),
                _ => slice,
            };
            slices.insert(segment_id, slice);
        }
    }
    let mut out = Composed::default();
    for (index, segment) in layout.segments.iter().enumerate() {
        if index > 0
            && let Some(divider) = divider_for(chat_id, layout, &segment.id, name_of)
        {
            out.messages.push(divider);
        }
        if segment.is_active() {
            out.active_from = out.messages.len();
        }
        out.messages
            .extend(slices.remove(&segment.id).unwrap_or_default());
    }
    out
}

fn native_cwd(deps: &dyn ChatManagerDeps, chat: &Chat) -> Option<String> {
    let project_path = deps.projects_get_path(&chat.project_id)?;
    crate::chat_cwd::chat_cwd(
        chat.worktree_path.as_deref(),
        chat.scratch_path.as_deref(),
        Some(project_path),
    )
}
