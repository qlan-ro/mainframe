//! The paged-history half of [`FakeSession`](super::FakeSession).
use std::sync::Mutex;

use mainframe_types::chat::ChatMessage;
use mainframe_types::sync::LockExt as _;

use crate::{HistoryPage, HistoryPageFuture, WindowRequest};

/// Pages newest first, each oldest first. No pages means the session cannot
/// page.
#[derive(Default)]
pub struct FakePages {
    pub pages: Vec<Vec<ChatMessage>>,
    /// The index of every page read, in order.
    pub requests: Mutex<Vec<usize>>,
}

impl FakePages {
    pub fn window<'a>(&'a self, req: WindowRequest<'a>) -> HistoryPageFuture<'a> {
        let mut messages: Vec<ChatMessage> = Vec::new();
        for (index, page) in self.pages.iter().enumerate() {
            self.requests.lock_recover().push(index);
            messages.splice(0..0, page.iter().cloned());
            if (req.enough)(&messages) {
                let older = index + 1 < self.pages.len();
                return Box::pin(async move { Ok(Some(HistoryPage { messages, older })) });
            }
        }
        let found = (!self.pages.is_empty()).then_some(HistoryPage {
            messages,
            older: false,
        });
        Box::pin(async move { Ok(found) })
    }
}
