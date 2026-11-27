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
use mainframe_types::sync::LockExt as _;

/// Turns asked for per page. Large enough that a typical window is one page,
/// small enough that a transcript of huge turns is not hydrated for it.
const PAGE_TURNS: usize = 16;
/// Pages read at most before the window is answered with what it has.
const MAX_PAGES: usize = 8;

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
        if !self.initial_history_eligible(chat_id)
            || self.shared.messages.lock_recover().get(chat_id).is_some()
            || self.shared.history_cache.has_snapshot(chat_id).await
        {
            return None;
        }
        let session = self.history_session(chat_id)?;
        let categories = self.shared.deps.get_tool_categories(chat_id);
        let mut cursor = None;
        let mut raw: Vec<ChatMessage> = Vec::new();
        let mut older = true;
        for _ in 0..MAX_PAGES {
            let page = match session.load_history_page(cursor.clone(), PAGE_TURNS).await {
                Ok(Some(page)) => page,
                Ok(None) if cursor.is_none() => return None,
                Ok(None) | Err(_) => break,
            };
            raw.splice(0..0, remap_history_for(page.messages, chat_id));
            older = page.older.is_some();
            if !older || self.display_of(chat_id, &raw, categories.as_ref()).len() >= containers {
                break;
            }
            cursor = page.older;
        }
        // Held prompts the normal load would show, without its side effects.
        if raw.is_empty() {
            return None;
        }
        let raw = self.shared.preview_idle_history(chat_id, raw).ok()?;
        Some(AdapterWindow {
            messages: self.display_of(chat_id, &raw, categories.as_ref()),
            has_older: older,
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
