use std::sync::Arc;

use mainframe_adapter_api::AdapterSession;
use mainframe_types::chat::Chat;

/// In-memory record for a chat the manager is tracking.
///
/// CONCURRENCY.tsv (`chat/chat-manager.ts activeChats`): the registry is a
/// `SHARED_MAP` whose values are PER_ENTITY. The port map folds the five
/// chatId-keyed maps into ONE `ChatState` behind one per-chat lock; until
/// `chat_manager` lands that fold, `ActiveChat` is the entity value (the leaf
/// managers in this task consume it directly, matching the TS shape).
#[derive(Clone)]
pub struct ActiveChat {
    pub chat: Chat,
    pub session: Option<Arc<dyn AdapterSession>>,
    /// `Date.now()` (ms) at the moment the current turn was dispatched to the
    /// CLI; read back in `onResult` to compute `turnDurationMs`.
    pub turn_started_at: Option<i64>,
    /// In-memory "last used" clock (todo #381), stamped at insertion and
    /// bumped by `ChatLifecycleManager::touch` on every use (load, start,
    /// send begin/end, history release, a config read). Never derived from
    /// the persisted chat's own timestamps, so a freshly created or loaded
    /// cell never inherits an old chat's age. Spawned-session idle eligibility
    /// still comes from `session.last_activity_at()` alone (`idle_scanner::idle_since`);
    /// this field is what makes a SESSION-LESS cell (never spawned, a failed
    /// spawn, or a REST `/resume` that never started) eligible for idle
    /// offload at all.
    pub last_used_at: i64,
}

impl ActiveChat {
    /// Construct a cell stamped with the current time as its `last_used_at`
    /// clock. Every production insertion point (`create_chat`, `do_load_chat`,
    /// the fork insert) must go through this rather than a bare struct literal,
    /// so a newly created or loaded chat is never immediately idle-eligible.
    pub fn new(chat: Chat, session: Option<Arc<dyn AdapterSession>>) -> Self {
        Self {
            chat,
            session,
            turn_started_at: None,
            last_used_at: now_ms(),
        }
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
