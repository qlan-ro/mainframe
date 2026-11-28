//! A stub adapter whose sessions page their history.
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use mainframe_adapter_api::test_support::FakePages;
use mainframe_adapter_api::{BoxFuture, HistoryPageFuture, WindowRequest};
use mainframe_types::chat::ChatMessage;

use super::StubAdapter;

/// A stub session's history: its pages (newest first, each oldest first),
/// whether a window read declines them, the file it is pinned to (so
/// snapshots and tails validate), and how often it was read whole.
#[derive(Default)]
pub(crate) struct StubHistory {
    pub(crate) pages: FakePages,
    /// The adapter declines to page, as for a short Claude transcript.
    pub(crate) declines: bool,
    /// `will_page_history` says yes, then the read declines (an ambiguous cut).
    pub(crate) declines_late: bool,
    pub(crate) source: Option<PathBuf>,
    pub(crate) loads: AtomicUsize,
}

impl StubHistory {
    pub(crate) fn new(pages: Vec<Vec<ChatMessage>>) -> Self {
        Self {
            pages: FakePages {
                pages,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    /// How many times the history was read whole.
    pub(crate) fn loads(&self) -> usize {
        self.loads.load(Ordering::SeqCst)
    }
}

impl StubAdapter {
    /// An adapter whose sessions page through `pages` (newest page first, each
    /// oldest first).
    pub(crate) fn paged(id: &str, pages: Vec<Vec<ChatMessage>>) -> Arc<Self> {
        Self::with_history(id, Arc::new(StubHistory::new(pages)))
    }

    pub(crate) fn with_history(id: &str, history: Arc<StubHistory>) -> Arc<Self> {
        let stub = Self::new(id, false);
        Arc::new(Self {
            pager: Some(history),
            ..Arc::try_unwrap(stub).unwrap_or_else(|_| unreachable!("just built"))
        })
    }
}

/// `load_history` for a stub session: every page, oldest first (nothing for
/// a session without pages).
pub(super) fn whole(history: Option<&StubHistory>) -> Vec<ChatMessage> {
    history.map_or_else(Vec::new, |history| {
        history.loads.fetch_add(1, Ordering::SeqCst);
        history
            .pages
            .pages
            .iter()
            .rev()
            .flatten()
            .cloned()
            .collect()
    })
}

/// `load_history_window` for a stub session: its pages, or "cannot page".
pub(super) fn window<'a>(
    history: Option<&'a StubHistory>,
    req: WindowRequest<'a>,
) -> HistoryPageFuture<'a> {
    match history.filter(|history| !history.declines && !history.declines_late) {
        Some(history) => history.pages.window(req),
        None => Box::pin(async { Ok(None) }),
    }
}

/// `will_page_history` for a stub session.
pub(super) fn will_page(history: Option<&StubHistory>) -> BoxFuture<'static, bool> {
    let pages = history.is_some_and(|history| !history.declines);
    Box::pin(async move { pages })
}

/// `history_sources` for a stub session: its pinned file, if any.
pub(super) fn sources(history: Option<&StubHistory>) -> BoxFuture<'static, Vec<PathBuf>> {
    let sources = history
        .and_then(|history| history.source.clone())
        .into_iter()
        .collect();
    Box::pin(async move { sources })
}
