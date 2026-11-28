//! The viewer seam the idle history release consults: whether any client is
//! looking at a chat right now. A chat on a desktop or mobile screen, or one an
//! agent is waiting on, keeps its history in memory.
//!
//! `mainframe-server` implements it over the facade hub's attached sessions,
//! the event socket's chat subscriptions and the orchestration waiters, and
//! attaches it once at boot ([`crate::chat_manager::ChatManager::attach_viewers`]).
//! A manager with none attached (most tests) sees every chat as unviewed.

pub trait ChatViewers: Send + Sync {
    fn is_viewed(&self, chat_id: &str) -> bool;
}
