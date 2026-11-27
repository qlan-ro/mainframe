//! The paged-history half of [`FakeSession`](super::FakeSession).
use std::sync::Mutex;

use mainframe_types::chat::ChatMessage;
use mainframe_types::sync::LockExt as _;

use crate::{HistoryPage, HistoryPageFuture};

/// Pages newest first, each oldest first; the cursor is the index of the next
/// (older) page. No pages means the session cannot page.
#[derive(Default)]
pub struct FakePages {
    pub pages: Vec<Vec<ChatMessage>>,
    /// Every request's cursor, in order.
    pub requests: Mutex<Vec<Option<String>>>,
}

impl FakePages {
    pub fn page(&self, cursor: Option<String>) -> HistoryPageFuture<'_> {
        self.requests.lock_recover().push(cursor.clone());
        let index = cursor.and_then(|c| c.parse::<usize>().ok()).unwrap_or(0);
        let page = self.pages.get(index).map(|messages| HistoryPage {
            messages: messages.clone(),
            older: (index + 1 < self.pages.len()).then(|| (index + 1).to_string()),
        });
        Box::pin(async move { Ok(page) })
    }
}
