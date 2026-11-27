//! A chat's first display window built from the adapter's own history pages.
//!
//! An uncached open used to read the whole transcript before the first window
//! could be answered. An adapter that can page its history (Codex, through
//! `thread/turns/list`) lets that window come from the newest turns alone.
//! The result is never stored: the chat's message cache still fills through
//! the usual full load, which the resume starts right after, so nothing that
//! needs the whole history (search, older pages, plans, compaction, the PR
//! scan, a send) ever sees a partial list.
use super::*;
use crate::window_marker;
use mainframe_adapter_api::WindowRequest;
use mainframe_types::sync::LockExt as _;

/// Turns asked for per page: on the benchmark fixture one page of this size
/// covers a window plus its snap margin.
const PAGE_TURNS: usize = 16;

/// The newest part of a chat's display history, and whether older turns exist.
pub struct AdapterWindow {
    pub messages: Vec<DisplayMessage>,
    pub has_older: bool,
}

impl ChatManager {
    /// The newest display messages, from the adapter's pages, once at least
    /// `containers` of them exist or the transcript starts. `None` when this
    /// open is not a candidate (a cached chat, a warm snapshot, a chat the
    /// cache must not serve, or an adapter that cannot page): the caller
    /// takes the normal load.
    pub async fn adapter_first_window(
        &self,
        chat_id: &str,
        containers: usize,
    ) -> Option<AdapterWindow> {
        self.adapter_first_window_by(chat_id, PAGE_TURNS, &move |messages| {
            messages.len() >= containers
        })
        .await
    }

    /// As [`Self::adapter_first_window`], stopping once `enough` accepts the
    /// display messages read so far, asking the adapter for `page_turns` turns
    /// a page.
    pub async fn adapter_first_window_by(
        &self,
        chat_id: &str,
        page_turns: usize,
        enough: &(dyn Fn(&[DisplayMessage]) -> bool + Send + Sync),
    ) -> Option<AdapterWindow> {
        if !self.initial_history_eligible(chat_id)
            || self.shared.messages.lock_recover().get(chat_id).is_some()
            || self.shared.history_cache.has_snapshot(chat_id).await
        {
            return None;
        }
        let session = self.history_session(chat_id)?;
        let categories = self.shared.deps.get_tool_categories(chat_id);
        let full =
            |raw: &[ChatMessage]| enough(&self.display_of(chat_id, raw, categories.as_ref()));
        let page = session
            .load_history_window(WindowRequest {
                turns: page_turns,
                enough: &move |messages| full(&remap_history_for(messages.to_vec(), chat_id)),
            })
            .await
            .ok()??;
        if page.messages.is_empty() {
            return None;
        }
        // The idle-compaction records the normal load folds in; a held prompt
        // is the one thing left out, because whether it was delivered cannot
        // be told from a partial list. The full load's tail then differs and
        // the client resyncs.
        let raw = remap_history_for(page.messages, chat_id);
        let raw = self.shared.merge_idle_provenance(chat_id, raw).ok()?;
        let messages = self.display_of(chat_id, &raw, categories.as_ref());
        // A load that filled the cache while the pages were read has already
        // settled this chat; a marker left now would judge the wrong window.
        if self.shared.messages.lock_recover().get(chat_id).is_some() {
            return None;
        }
        // The full load that follows decides whether this window held up.
        self.shared
            .history_cache
            .mark_window(chat_id, window_marker::fingerprint(&messages));
        Some(AdapterWindow {
            messages,
            has_older: page.older,
        })
    }

    fn display_of(
        &self,
        chat_id: &str,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        self.shared
            .deps
            .prepare_messages_for_client(chat_id, raw, categories)
    }
}
