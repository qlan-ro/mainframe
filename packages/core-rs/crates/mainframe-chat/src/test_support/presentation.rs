use mainframe_types::sync::LockExt as _;
use std::sync::{Arc, Mutex};

use crate::chat_manager::ChatShared;
use crate::event_handler::EventHandler;
use crate::message_cache::MessageCache;
use crate::worktree_offer::WorktreeOfferRegistry;
use mainframe_display::DisplayProjector;
use mainframe_types::display::ToolCategories;

pub fn presentation_handler(
    messages: Arc<Mutex<MessageCache>>,
    projector: fn() -> Box<dyn DisplayProjector>,
    categories: Option<ToolCategories>,
) -> EventHandler {
    let mut deps = super::FakeDeps::default();
    deps.adapters.projector_factory = Some(projector);
    *deps.adapters.tool_categories.lock_recover() = categories;
    let shared = ChatShared::with_messages(Arc::new(deps), messages);
    let offers = Arc::new(WorktreeOfferRegistry::new(shared.clone()));
    EventHandler::new(shared, offers)
}
