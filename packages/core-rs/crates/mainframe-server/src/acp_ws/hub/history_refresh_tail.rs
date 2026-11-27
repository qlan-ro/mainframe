//! Builds and stores the first-window tail from a refreshed history.
use mainframe_acp::ResumeOptions;
use mainframe_acp::resume::persisted::PreparedHistoryTail;
use mainframe_acp::resume::{BoxFuture, ResumePort, ResumeSnapshot, SnapshotReader};
use mainframe_chat::chat_manager::{ChatManager, RefreshedHistory};
use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use mainframe_types::display::DisplayMessage;
use serde_json::{Value, json};

use super::TailWindow;
use crate::acp_ws::hub::history_tail::{Manifest, TailStore, store};

/// Builds the first window a cold resume would send for `refreshed`, through
/// the same encoder a live resume uses, and stores it as the chat's tail.
pub(super) async fn write_tail(
    manager: &ChatManager,
    store: &TailStore,
    chat_id: &str,
    window: TailWindow,
    refreshed: RefreshedHistory,
) {
    let RefreshedHistory {
        messages,
        validation,
    } = refreshed;
    let options = ResumeOptions {
        result_previews: window.previews,
        windowed_history: true,
        ..Default::default()
    };
    let request = first_window_request(chat_id, &window.window);
    let port = StoredHistory(messages);
    let (response, replay): (JsonRpcResponse, _) =
        mainframe_acp::dispatch_resume_with(request, &port, None, options).await;
    let prepared =
        tokio::task::spawn_blocking(move || PreparedHistoryTail::capture(&response, &replay)).await;
    let Ok(Some(tail)) = prepared else {
        return;
    };
    if !manager
        .validate_refreshed_history(chat_id, &validation)
        .await
    {
        return;
    }
    let manifest = Manifest {
        version: store::FORMAT_VERSION,
        generation: nanoid::nanoid!(),
        chat_id: chat_id.to_owned(),
        window: window.window,
        previews: window.previews,
        validation,
    };
    if let Some(permit) = store.writer_wait().await {
        store.write(manifest, tail, permit).await;
    }
}

fn first_window_request(chat_id: &str, window: &Value) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".into(),
        id: None,
        method: "session/resume".into(),
        params: Some(json!({
            "sessionId": chat_id,
            "cwd": "",
            "replayFrom": { "type": "start" },
            "_meta": { MAINFRAME_META_NAMESPACE: { "window": window } },
        })),
    }
}

/// A resume port over an already-built display history of an idle chat.
struct StoredHistory(Vec<DisplayMessage>);

impl ResumePort for StoredHistory {
    fn resume_snapshot<'a>(&'a self, _session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
        Box::pin(async move {
            ResumeSnapshot {
                messages: self.0.clone(),
                streaming: None,
                pending: None,
            }
        })
    }

    fn read_snapshot<'a>(
        &'a self,
        _session_id: &'a str,
        read: SnapshotReader<'a>,
    ) -> BoxFuture<'a, (JsonRpcResponse, mainframe_acp::ResumeReplay)> {
        Box::pin(async move { read(&self.0, None, None) })
    }

    fn is_running(&self, _session_id: &str) -> bool {
        false
    }
}
