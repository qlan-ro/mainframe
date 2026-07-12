//! Ported from `packages/core/src/chat/types.ts`.

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
}

// PORT STATUS: src/chat/types.ts (8 lines)
// confidence: high
// todos: 0
// notes: `session: AdapterSession | null` → `Option<Arc<dyn AdapterSession>>`
// notes: (the session handle is shared/`Arc` per CONCURRENCY rule 4). `turnStartedAt`
// notes: (JS ms epoch) → `Option<i64>`. ActiveChat stays the per-entity value until
// notes: chat_manager folds it into ChatState (CONCURRENCY.tsv rule 1).
