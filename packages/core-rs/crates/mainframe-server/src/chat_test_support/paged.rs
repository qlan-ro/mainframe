//! A stub adapter whose sessions page their history.
use std::sync::Arc;

use mainframe_adapter_api::test_support::FakePages;
use mainframe_adapter_api::{HistoryPageFuture, WindowRequest};
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

/// `load_history` for a stub session: every page, oldest first (nothing for
/// a session that cannot page).
pub(super) fn whole(pager: Option<&FakePages>) -> Vec<ChatMessage> {
    pager.map_or_else(Vec::new, |pager| {
        pager.pages.iter().rev().flatten().cloned().collect()
    })
}

/// `load_history_window` for a stub session: its pages, or "cannot page".
pub(super) fn window<'a>(
    pager: Option<&'a FakePages>,
    req: WindowRequest<'a>,
) -> HistoryPageFuture<'a> {
    match pager {
        Some(pager) => pager.window(req),
        None => Box::pin(async { Ok(None) }),
    }
}
