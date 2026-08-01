//! Moved out of `event_mapper.rs` (task 1, todo #247) to keep that file under
//! the 300-line ceiling. `CodexSessionState` and its two small value types,
//! unchanged.

use std::collections::HashMap;

use crate::thread_registry::ThreadRegistryDeps;

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

/// A sub-agent delegation card, keyed by the child's Codex thread id.
#[derive(Debug, Clone, PartialEq)]
pub struct SubAgentCard {
    /// The parent CollabAgent tool_use id this card renders as.
    pub card_id: String,
    pub title: String,
    pub open: bool,
    pub resolved: bool,
    pub last_message: Option<String>,
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
    /// child thread id → delegation card.
    pub sub_agent_cards: HashMap<String, SubAgentCard>,
    /// child thread id → spawn prompt (captured from `spawnAgent` items).
    pub spawn_prompts: HashMap<String, String>,
    /// Per-turn dedupe: compact-done already emitted (item or legacy `thread/compacted` path).
    pub compaction_emitted: bool,
    /// Registry DB override — `None` in production, `Some` in tests.
    pub registry_deps: Option<ThreadRegistryDeps>,
}

impl CodexSessionState {
    pub fn card_for_thread(&self, tid: &str) -> Option<&SubAgentCard> {
        self.sub_agent_cards.get(tid)
    }

    pub fn open_card_ids(&self) -> Vec<String> {
        self.sub_agent_cards
            .values()
            .filter(|c| c.open)
            .map(|c| c.card_id.clone())
            .collect()
    }

    pub fn thread_for_card(&self, card_id: &str) -> Option<String> {
        self.sub_agent_cards
            .iter()
            .find(|(_, card)| card.card_id == card_id)
            .map(|(tid, _)| tid.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(card_id: &str, open: bool) -> SubAgentCard {
        SubAgentCard {
            card_id: card_id.to_string(),
            title: "Maxwell".to_string(),
            open,
            resolved: false,
            last_message: None,
        }
    }

    #[test]
    fn card_for_thread_finds_the_card_keyed_by_thread_id() {
        let mut state = CodexSessionState::default();
        state
            .sub_agent_cards
            .insert("t1".to_string(), card("c1", true));
        assert_eq!(
            state.card_for_thread("t1").map(|c| &c.card_id),
            Some(&"c1".to_string())
        );
        assert_eq!(state.card_for_thread("missing"), None);
    }

    #[test]
    fn open_card_ids_returns_only_open_cards() {
        let mut state = CodexSessionState::default();
        state
            .sub_agent_cards
            .insert("t1".to_string(), card("c1", true));
        state
            .sub_agent_cards
            .insert("t2".to_string(), card("c2", false));
        assert_eq!(state.open_card_ids(), vec!["c1".to_string()]);
    }

    #[test]
    fn thread_for_card_reverse_looks_up_the_thread_id() {
        let mut state = CodexSessionState::default();
        state
            .sub_agent_cards
            .insert("t1".to_string(), card("c1", true));
        assert_eq!(state.thread_for_card("c1"), Some("t1".to_string()));
        assert_eq!(state.thread_for_card("missing"), None);
    }
}
