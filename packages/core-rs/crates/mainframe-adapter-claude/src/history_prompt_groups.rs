//! Prompt-group provenance for reloaded Claude history.
//!
//! A reply to a hidden prompt (a `<task-notification>`, an `isMeta` resume)
//! has no visible user message before it, so display grouping would merge it
//! into the previous reply. Every native user record carries a `promptId`;
//! an assistant record belongs to the prompt of its nearest user ancestor
//! along `parentUuid`. The index is built from every main-transcript record
//! before visibility filtering, so hidden prompts still name their group.
//!
//! Ancestry that is missing, cyclic, or reaches a root without a prompt is
//! unknown: the message gets no key and display grouping keeps today's merge.
//! Duplicate UUIDs keep their first record.

use std::collections::{HashMap, HashSet};

use mainframe_types::chat::ChatMessage;
use mainframe_types::transcript_presentation::TURN_GROUP_KEY;
use serde_json::Value;

struct Record {
    parent: Option<String>,
    /// Session-scoped prompt group, on user records with a `promptId`.
    prompt: Option<String>,
}

#[derive(Default)]
pub(crate) struct PromptGroups {
    records: HashMap<String, Record>,
    /// Loaded-message index of each assistant message and its native uuid.
    tracked: Vec<(usize, String)>,
}

fn text_field<'a>(entry: &'a Value, key: &str) -> Option<&'a str> {
    entry
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

impl PromptGroups {
    /// Index one main-transcript record, visible or not.
    pub(crate) fn observe(&mut self, entry: &Value, session_id: &str) {
        let Some(uuid) = text_field(entry, "uuid") else {
            return;
        };
        if self.records.contains_key(uuid) {
            return;
        }
        let prompt = (text_field(entry, "type") == Some("user"))
            .then(|| text_field(entry, "promptId"))
            .flatten()
            .map(|prompt_id| {
                let session = text_field(entry, "sessionId").unwrap_or(session_id);
                serde_json::json!([session, prompt_id]).to_string()
            });
        let parent = text_field(entry, "parentUuid").map(str::to_string);
        self.records
            .insert(uuid.to_string(), Record { parent, prompt });
    }

    /// Remember that loaded message `index` came from `entry`.
    pub(crate) fn track(&mut self, index: usize, entry: &Value) {
        if let Some(uuid) = text_field(entry, "uuid") {
            self.tracked.push((index, uuid.to_string()));
        }
    }

    /// Stamp each tracked message whose prompt group resolves.
    pub(crate) fn apply(self, messages: &mut [ChatMessage]) {
        let mut memo: HashMap<String, Option<String>> = HashMap::new();
        for (index, uuid) in &self.tracked {
            let (Some(group), Some(message)) =
                (self.resolve(uuid, &mut memo), messages.get_mut(*index))
            else {
                continue;
            };
            message
                .metadata
                .get_or_insert_default()
                .insert(TURN_GROUP_KEY.to_string(), Value::String(group));
        }
    }

    fn resolve(&self, uuid: &str, memo: &mut HashMap<String, Option<String>>) -> Option<String> {
        let mut path: Vec<&str> = Vec::new();
        let mut visited: HashSet<&str> = HashSet::new();
        let mut cursor = Some(uuid);
        let group = loop {
            let Some(current) = cursor else { break None };
            if let Some(known) = memo.get(current) {
                break known.clone();
            }
            let Some(record) = self.records.get(current) else {
                break None;
            };
            if !visited.insert(current) {
                break None;
            }
            path.push(current);
            if let Some(prompt) = &record.prompt {
                break Some(prompt.clone());
            }
            cursor = record.parent.as_deref();
        };
        for node in path {
            memo.insert(node.to_string(), group.clone());
        }
        group
    }
}

#[cfg(test)]
#[path = "history_prompt_groups_tests.rs"]
mod tests;
