use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::acp::jsonrpc::{JsonRpcResponse, RequestId};
use mainframe_types::acp::session::ResumeSessionRequest;
use mainframe_types::sync::LockExt as _;
use serde_json::json;
use std::sync::Mutex;

use super::{ResumeOptions, ResumePort, ResumeReplay};
use crate::{RevisionLog, SessionState, encoder, history_window, replay_previews};
use mainframe_types::acp::extensions::RevisionCursor;

#[path = "windowed_selection.rs"]
mod selection;
use selection::Selection;

pub(super) struct SnapshotView<'a> {
    pub messages: &'a [mainframe_types::display::DisplayMessage],
    pub streaming: Option<mainframe_types::display::StreamingLeafKind>,
}

pub(super) async fn dispatch(
    id: Option<RequestId>,
    resume: ResumeSessionRequest,
    port: &dyn ResumePort,
    log: Option<(&Mutex<RevisionLog>, RevisionCursor)>,
    options: ResumeOptions,
) -> (JsonRpcResponse, ResumeReplay) {
    let window = match history_window::parse_window(resume.meta.as_ref()) {
        Ok(window) => window,
        Err(err) => {
            return (
                crate::rpc::error_response(id, crate::rpc::invalid_params(&err.to_string())),
                super::empty_replay(),
            );
        }
    };
    let session_id = resume.session_id.clone();
    let (response, mut replay) = port
        .read_snapshot(
            &session_id,
            Box::new(move |messages, streaming, pending| {
                prepare(
                    id,
                    resume,
                    window,
                    SnapshotView {
                        messages,
                        streaming,
                    },
                    pending,
                    log,
                    options,
                )
            }),
        )
        .await;
    replay.updates.push(super::running_state(port, &session_id));
    (response, replay)
}

fn prepare(
    id: Option<RequestId>,
    resume: ResumeSessionRequest,
    window: mainframe_types::acp::extensions::HistoryWindow,
    snapshot: SnapshotView<'_>,
    pending: Option<mainframe_types::adapter::ControlRequest>,
    log: Option<(&Mutex<RevisionLog>, RevisionCursor)>,
    options: ResumeOptions,
) -> (JsonRpcResponse, ResumeReplay) {
    seed_log(
        log.as_ref().map(|(log, _)| *log),
        &snapshot,
        &resume.session_id,
    );
    let started = std::time::Instant::now();
    let selection = Selection::new(
        &snapshot,
        resume.replay_from.as_ref(),
        &window,
        log.as_ref().map(|(log, _)| *log),
    );
    let history = selection.history.clone();
    let fallback = selection.fallback;
    let floor_position = selection.start;
    let mut replay = prepare_replay(selection, pending, options);
    let mut meta = super::resume_meta(
        replay.updates.len(),
        fallback,
        log.as_ref().map(|(_, boundary)| boundary),
    );
    meta[MAINFRAME_META_NAMESPACE]["history"] = json!(history);
    let response = crate::rpc::success_response(id, json!({ "_meta": meta }));
    replay.pending_permission_request = replay
        .pending_gate
        .as_ref()
        .map(|request| super::build_pending_permission_request(&resume.session_id, request));
    tracing::info!(
        chat_id = resume.session_id,
        window_size = replay.containers.len() - floor_position,
        floor_position,
        has_more = history.has_more,
        encode_ms = started.elapsed().as_secs_f64() * 1000.0,
        "prepared transcript window"
    );
    (response, replay)
}

fn seed_log(log: Option<&Mutex<RevisionLog>>, snapshot: &SnapshotView<'_>, chat_id: &str) {
    let Some(log) = log else {
        return;
    };
    let mut log = log.lock_recover();
    if log.is_seeded() {
        return;
    }
    let started = std::time::Instant::now();
    log.seed_containers(&encoder::encode_containers(
        snapshot.messages,
        snapshot.streaming,
    ));
    tracing::info!(
        chat_id,
        seed_ms = started.elapsed().as_secs_f64() * 1000.0,
        "seeded transcript revision log"
    );
}

fn prepare_replay(
    selection: Selection,
    pending: Option<mainframe_types::adapter::ControlRequest>,
    options: ResumeOptions,
) -> ResumeReplay {
    let Selection {
        containers,
        start,
        plan,
        ..
    } = selection;
    let items: Vec<_> = containers.iter().flatten().cloned().collect();
    let preview_ids = if options.result_previews {
        replay_previews::preview_ids(&containers)
    } else {
        Default::default()
    };
    let mut state = SessionState::new();
    state.set_previews(preview_ids.clone());
    let updates = match plan {
        crate::ReplayPlan::Incremental(updates) => preview_updates(updates, &items, &preview_ids),
        crate::ReplayPlan::Full => state.diff(&items),
    };
    let mut aligned = vec![Vec::new(); start];
    aligned.extend(containers);
    ResumeReplay {
        updates,
        items,
        containers: aligned,
        preview_ids,
        pending_permission_request: None,
        pending_gate: pending,
    }
}

fn preview_updates(
    updates: Vec<mainframe_types::acp::update::SessionUpdate>,
    items: &[crate::EncodedItem],
    previews: &std::collections::HashSet<String>,
) -> Vec<mainframe_types::acp::update::SessionUpdate> {
    updates
        .into_iter()
        .map(|update| {
            if let mainframe_types::acp::update::SessionUpdate::ToolCallUpdate(tool) = &update
                && previews.contains(&tool.tool_call_id)
                && let Some(item) = items.iter().find(|item| item.id() == tool.tool_call_id)
            {
                return crate::session_state::updates::create_update(
                    &replay_previews::preview_item(item),
                );
            }
            update
        })
        .collect()
}
