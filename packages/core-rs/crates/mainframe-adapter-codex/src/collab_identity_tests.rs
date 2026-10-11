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
