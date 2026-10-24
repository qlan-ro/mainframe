use std::path::PathBuf;
use std::sync::Arc;

use mainframe_acp::resume::persisted::PreparedHistoryTail;
use mainframe_acp::{ResumeOptions, ResumeReplay};
use mainframe_chat::chat_manager::ChatManager;
use mainframe_types::acp::extensions::RevisionCursor;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use mainframe_types::acp::session::ResumeSessionRequest;
use serde_json::Value;

use super::FacadeHub;
mod store;
use store::Manifest;
pub(super) use store::TailStore;

impl FacadeHub {
    pub(crate) fn with_history_tails(mut self, directory: PathBuf) -> Self {
        self.history_tails = Some(Arc::new(TailStore::new(directory)));
        self
    }

    pub(crate) async fn initial_history_ready(&self, manager: &ChatManager, chat_id: &str) -> bool {
        let Some(store) = &self.history_tails else {
            return false;
        };
        let Some(manifest) = store.manifest(chat_id).await else {
            return false;
        };
        manager
            .validate_initial_history(chat_id, &manifest.validation)
            .await
            && store.tail(&manifest).await.is_some()
    }

    pub(crate) async fn persisted_resume(
        &self,
        manager: &ChatManager,
        request: &JsonRpcRequest,
        options: ResumeOptions,
        cursor: Option<&RevisionCursor>,
    ) -> Option<(JsonRpcResponse, ResumeReplay)> {
        let (chat_id, window) = first_window(request, options)?;
        let store = self.history_tails.as_ref()?;
        let manifest = store.manifest(&chat_id).await?;
        if manifest.window != window
            || manifest.previews != options.result_previews
            || !manager
                .validate_initial_history(&chat_id, &manifest.validation)
                .await
        {
            return None;
        }
        let tail = store.tail(&manifest).await?;
        if !manager
            .validate_initial_history(&chat_id, &manifest.validation)
            .await
        {
            return None;
        }
        tracing::info!(chat_id, "restored persisted transcript tail");
        manager.mark_initial_history_served(&chat_id, manifest.validation);
        Some(tail.replay(request.id.clone(), cursor))
    }

    pub(crate) fn persist_resume(
        &self,
        manager: Arc<ChatManager>,
        request: JsonRpcRequest,
        response: JsonRpcResponse,
        mut replay: ResumeReplay,
        options: ResumeOptions,
        validation: Option<mainframe_chat::HistoryValidation>,
    ) {
        let Some((chat_id, window)) = first_window(&request, options) else {
            return;
        };
        let Some(store) = self.history_tails.clone() else {
            return;
        };
        let Some(validation) = validation else {
            return;
        };
        let Some(permit) = store.writer() else {
            return;
        };
        if replay.pending_gate.is_some() {
            return;
        }
        replay.items.clear();
        tokio::spawn(async move {
            let prepared = tokio::task::spawn_blocking(move || {
                PreparedHistoryTail::capture(&response, &replay)
            })
            .await;
            let Ok(Some(tail)) = prepared else {
                return;
            };
            if !manager.validate_history(&chat_id, &validation).await {
                return;
            }
            let manifest = Manifest {
                version: 1,
                generation: nanoid::nanoid!(),
                chat_id,
                window,
                previews: options.result_previews,
                validation,
            };
            store.write(manifest, tail, permit).await;
        });
    }

    pub(crate) fn seed_history_snapshot(
        &self,
        chat_id: &str,
        messages: &[mainframe_types::display::DisplayMessage],
    ) {
        use mainframe_types::sync::LockExt as _;
        let Some(log) = self.revision_log_for_resume(self.has_revision_log(chat_id), chat_id)
        else {
            return;
        };
        let mut log = log.lock_recover();
        if !log.is_seeded() {
            log.seed_containers(&mainframe_acp::encoder::encode_containers(messages, None));
        }
    }
}

fn first_window(request: &JsonRpcRequest, options: ResumeOptions) -> Option<(String, Value)> {
    if !options.windowed_history {
        return None;
    }
    let resume: ResumeSessionRequest = serde_json::from_value(request.params.clone()?).ok()?;
    if let Some(cursor) = resume.replay_from
        && serde_json::from_value::<mainframe_acp::resume::ReplayCursor>(cursor).ok()
            != Some(mainframe_acp::resume::ReplayCursor::Start)
    {
        return None;
    }
    let window = mainframe_acp::history_window::parse_window(resume.meta.as_ref()).ok()?;
    if window.floor_item_id.is_some() {
        return None;
    }
    Some((resume.session_id, serde_json::to_value(window).ok()?))
}

#[cfg(test)]
mod tests;
