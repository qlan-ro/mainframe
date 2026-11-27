//! A stub adapter whose sessions page their history.
use std::sync::Arc;

use mainframe_adapter_api::HistoryPageFuture;
use mainframe_adapter_api::test_support::FakePages;
use mainframe_types::chat::ChatMessage;

use super::StubAdapter;

impl StubAdapter {
    /// An adapter whose sessions page through `pages` (newest page first, each
    /// oldest first).
    pub(crate) fn paged(id: &str, pages: Vec<Vec<ChatMessage>>) -> Arc<Self> {
        let stub = Self::new(id, false);
        Arc::new(Self {
            pager: Some(Arc::new(FakePages {
                pages,
                ..Default::default()
            })),
            ..Arc::try_unwrap(stub).unwrap_or_else(|_| unreachable!("just built"))
        })
    }
}

/// `load_history_page` for a stub session: its pages, or "cannot page".
pub(super) fn page(pager: Option<&FakePages>, cursor: Option<String>) -> HistoryPageFuture<'_> {
    match pager {
        Some(pager) => pager.page(cursor),
        None => Box::pin(async { Ok(None) }),
    }
}
