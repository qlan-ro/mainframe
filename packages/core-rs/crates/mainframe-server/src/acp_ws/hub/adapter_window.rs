//! The first resume window for a chat nothing has cached, built from the
//! adapter's newest history pages instead of its whole transcript.
//!
//! It answers the way a persisted tail does: the window's containers and
//! `has_more`, with the revision log left unseeded. The caller's usual
//! follow-up (`complete_history`) loads the chat in full, so the first page
//! request or live event seeds the log from the real list, as after a tail.
//! The window is never persisted as a tail: it was built from a partial list.

use mainframe_acp::resume::persisted::PreparedHistoryTail;
use mainframe_acp::resume::{BoxFuture, ResumePort, ResumeSnapshot};
use mainframe_acp::{
    ResumeOptions, ResumeReplay, dispatch_resume_with, history_window, turn_window,
};
use mainframe_chat::chat_manager::ChatManager;
use mainframe_types::acp::extensions::RevisionCursor;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use mainframe_types::acp::session::ResumeSessionRequest;
use mainframe_types::display::DisplayMessage;

use super::FacadeHub;
use super::history_tail::first_window;

/// Containers a window can pull in beyond its size: the start snaps back over
/// up to 8 to land on a user message.
const SNAP_MARGIN: usize = 9;

/// Adapter turns asked for per page, as on a window by containers.
const PAGE_TURNS: usize = 16;

/// Serves a fixed list as the chat's history, idle.
struct WindowPort(Vec<DisplayMessage>);

impl ResumePort for WindowPort {
    fn resume_snapshot<'a>(&'a self, _session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
        Box::pin(async move {
            ResumeSnapshot {
                messages: self.0.clone(),
                streaming: None,
                pending: None,
            }
        })
    }

    fn is_running(&self, _session_id: &str) -> bool {
        false
    }
}

impl FacadeHub {
    pub(crate) async fn adapter_window_resume(
        &self,
        manager: &ChatManager,
        request: &JsonRpcRequest,
        options: ResumeOptions,
        cursor: Option<&RevisionCursor>,
    ) -> Option<(JsonRpcResponse, ResumeReplay)> {
        let (chat_id, _) = first_window(request, options)?;
        let resume: ResumeSessionRequest = serde_json::from_value(request.params.clone()?).ok()?;
        let window = history_window::parse_window(resume.meta.as_ref()).ok()?;
        let found = match window.turns {
            // The newest `turns` turns, each opened by its own start, so a
            // partial list holding that many starts holds the whole window.
            Some(turns) => {
                let turns = turn_window::turn_count(turns);
                manager
                    .adapter_first_window_by(&chat_id, turns.max(PAGE_TURNS), &move |messages| {
                        turn_window::count_turns(messages) >= turns
                    })
                    .await?
            }
            None => {
                let wanted = history_window::page_size(window.containers) + SNAP_MARGIN;
                manager.adapter_first_window(&chat_id, wanted).await?
            }
        };
        // The list is partial, so it must not seed any revision log.
        let (response, replay) =
            dispatch_resume_with(request.clone(), &WindowPort(found.messages), None, options).await;
        let tail =
            PreparedHistoryTail::capture(&response, &replay)?.with_older_history(found.has_older);
        tracing::info!(chat_id, "answered the first window from adapter pages");
        Some(tail.replay(request.id.clone(), cursor))
    }
}

#[cfg(test)]
#[path = "adapter_window_tests.rs"]
mod tests;
