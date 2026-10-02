use std::collections::HashMap;

use crate::command_metadata::metadata;
use crate::item_types::CommandExecutionItem;
use mainframe_types::command_execution::CommandExecutionMetadata;

#[derive(Debug, Default)]
pub struct CommandState {
    pending: HashMap<(String, String), (Option<String>, Option<CommandExecutionMetadata>)>,
    turns: HashMap<String, Option<String>>,
}

impl CommandState {
    pub(crate) fn start_turn(&mut self, thread: &str, turn: &str) {
        self.pending.retain(|(tid, _), _| tid != thread);
        self.turns
            .insert(thread.to_string(), Some(turn.to_string()));
    }

    pub(crate) fn end_turn(&mut self, thread: &str, turn: &str) {
        if self.accepts(thread, Some(turn)) {
            self.pending.retain(|(tid, _), _| tid != thread);
            self.turns.insert(thread.to_string(), None);
        }
    }

    pub(crate) fn end_parent_turn(&mut self, thread: &str, turn: &str) {
        if self.accepts(thread, Some(turn)) {
            self.clear();
        }
    }

    pub(crate) fn clear_thread(&mut self, thread: &str) {
        self.pending.retain(|(tid, _), _| tid != thread);
        self.turns.insert(thread.to_string(), None);
    }

    pub(crate) fn clear(&mut self) {
        self.pending.clear();
        for turn in self.turns.values_mut() {
            *turn = None;
        }
    }

    fn accepts(&self, thread: &str, turn: Option<&str>) -> bool {
        match self.turns.get(thread) {
            Some(None) => false,
            Some(Some(current)) => current.is_empty() || turn.is_none_or(|id| id == current),
            None => true,
        }
    }

    pub(crate) fn started(
        &mut self,
        thread: &str,
        turn: Option<&str>,
        item: &CommandExecutionItem,
    ) {
        if !self.accepts(thread, turn) {
            return;
        }
        self.turns
            .entry(thread.to_string())
            .or_insert_with(|| Some(turn.unwrap_or_default().to_string()));
        self.pending.insert(
            (thread.to_string(), item.id.clone()),
            (turn.map(str::to_string), metadata(item)),
        );
    }

    pub(crate) fn complete(
        &mut self,
        thread: &str,
        turn: Option<&str>,
        item: &mut CommandExecutionItem,
    ) {
        if !self.accepts(thread, turn) {
            return;
        }
        let key = (thread.to_string(), item.id.clone());
        if self.pending.get(&key).is_some_and(
            |(started, _)| matches!((started.as_deref(), turn), (Some(a), Some(b)) if a != b),
        ) {
            return;
        }
        if let Some((_, Some(prior))) = self.pending.remove(&key) {
            item.command_actions = item.command_actions.take().or(prior.command_actions);
            item.duration_ms = item.duration_ms.or(prior.reported_duration_ms);
        }
    }
}
