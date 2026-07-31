//! Moved out of `event_mapper.rs` (task 1, todo #247) to keep that file under
//! the 300-line ceiling. `CodexSessionState` and its two small value types,
//! unchanged.

use std::collections::{HashMap, HashSet};

/// The `{ id, text }` plan captured incrementally across a turn.
#[derive(Debug, Clone, PartialEq)]
pub struct CurrentTurnPlan {
    pub id: String,
    pub text: String,
}

/// Last token-usage snapshot, carried into the terminal `turn/completed` result.
#[derive(Debug, Clone, PartialEq)]
pub struct LastUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_input_tokens: Option<i64>,
}

/// Per-session mutable state driven by the notification stream (SINGLE_TASK per
/// CONCURRENCY.tsv row 95 — owned by the session actor). The lazily-created TS
/// `Set`/`Map` fields become always-present empty collections here.
#[derive(Debug, Default)]
pub struct CodexSessionState {
    pub thread_id: Option<String>,
    pub current_turn_id: Option<String>,
    pub current_turn_plan: Option<CurrentTurnPlan>,
    pub last_usage: Option<LastUsage>,
    /// collabAgentToolCall item ids that already had a CollabAgent tool_use emitted.
    pub open_collab_cards: HashSet<String>,
    /// child thread id → parent CollabAgent tool_use id.
    pub collab_child_threads: HashMap<String, String>,
    /// child thread id → spawn prompt (captured from `spawnAgent` items).
    pub spawn_prompts: HashMap<String, String>,
    /// Per-turn dedupe: compact-done already emitted (item or legacy `thread/compacted` path).
    pub compaction_emitted: bool,
    /// CollabAgent tool_use ids already resolved to an errored state by an
    /// `interrupted` `subAgentActivity` ping, ahead of the card's own completion.
    pub errored_collab_cards: HashSet<String>,
    /// child thread id → the live rollout-tail task streaming that child's work
    /// into the TaskCard, plus its cancellation handle (stopped on wait completion).
    pub child_tails: HashMap<
        String,
        (
            tokio::task::JoinHandle<()>,
            tokio_util::sync::CancellationToken,
        ),
    >,
}
