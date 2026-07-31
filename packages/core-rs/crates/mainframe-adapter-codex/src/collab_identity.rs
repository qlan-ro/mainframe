//! Todo #247 (CollabAgent sub-agent delegation): identity chains shared by the
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
/// humanized spawn path, then a generic fallback (spec decision 6).
pub(crate) fn card_title(meta: Option<&AgentMetadata>, agent_path: Option<&str>) -> String {
    agent_title(meta)
        .or_else(|| describe_agent(meta))
        .or_else(|| agent_path.and_then(humanize_agent_path))
        .unwrap_or_else(|| "Sub-agent".to_string())
}

/// The card's task line: the spawn prompt when present and non-blank, otherwise
/// the card title (spec decision 7 — the line must never be blank).
pub(crate) fn card_task_line(prompt: Option<&str>, title: &str) -> String {
    match prompt {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => title.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread_registry::AgentMetadata;

    #[test]
    fn humanizes_the_last_path_segment() {
        assert_eq!(
            humanize_agent_path("/root/compute_sum"),
            Some("compute sum".to_string())
        );
    }

    #[test]
    fn humanize_returns_none_for_empty_or_root() {
        assert_eq!(humanize_agent_path(""), None);
        assert_eq!(humanize_agent_path("/"), None);
    }

    #[test]
    fn card_title_prefers_registry_nickname() {
        let meta = AgentMetadata {
            nickname: Some("Maxwell".to_string()),
            role: Some("explorer".to_string()),
            rollout_path: None,
        };
        assert_eq!(
            card_title(Some(&meta), Some("/root/compute_sum")),
            "Maxwell"
        );
    }

    #[test]
    fn card_title_falls_back_to_role_when_nickname_absent() {
        let meta = AgentMetadata {
            nickname: None,
            role: Some("explorer".to_string()),
            rollout_path: None,
        };
        assert_eq!(
            card_title(Some(&meta), Some("/root/compute_sum")),
            "explorer"
        );
    }

    #[test]
    fn card_title_falls_back_to_humanized_path_when_no_metadata() {
        assert_eq!(card_title(None, Some("/root/compute_sum")), "compute sum");
    }

    #[test]
    fn card_title_falls_back_to_sub_agent_when_nothing_resolves() {
        assert_eq!(card_title(None, None), "Sub-agent");
        assert_eq!(card_title(None, Some("/")), "Sub-agent");
    }

    #[test]
    fn card_task_line_uses_prompt_when_present() {
        assert_eq!(
            card_task_line(Some("do the thing"), "Maxwell"),
            "do the thing"
        );
    }

    #[test]
    fn card_task_line_falls_back_to_title_on_none_or_empty() {
        assert_eq!(card_task_line(None, "Maxwell"), "Maxwell");
        assert_eq!(card_task_line(Some(""), "Maxwell"), "Maxwell");
    }
}
