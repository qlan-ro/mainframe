//! CollabAgent sub-agent delegation: identity chains shared by the
//! live and reload paths for naming a sub-agent card.

use crate::thread_registry::{AgentMetadata, agent_title, describe_agent};

/// Last non-empty `/`-separated segment of an agent path, `_` turned into spaces.
/// `None` when the path has no such segment (empty, or just `/`).
pub(crate) fn humanize_agent_path(path: &str) -> Option<String> {
    let segment = path.split('/').next_back().unwrap_or("").trim();
    if segment.is_empty() {
        return None;
    }
    Some(segment.replace('_', " "))
}

/// Best display name for a sub-agent card: registry nickname, then role, then a
/// humanized spawn path, then a generic fallback.
pub(crate) fn card_title(meta: Option<&AgentMetadata>, agent_path: Option<&str>) -> String {
    agent_title(meta)
        .or_else(|| describe_agent(meta))
        .or_else(|| agent_path.and_then(humanize_agent_path))
        .unwrap_or_else(|| "Sub-agent".to_string())
}

/// The card's task line: the spawn prompt when present and non-blank, otherwise
/// the card title (the line must never be blank).
pub(crate) fn card_task_line(prompt: Option<&str>, title: &str) -> String {
    match prompt {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => title.to_string(),
    }
}

#[cfg(test)]
#[path = "collab_identity_tests.rs"]
mod tests;
