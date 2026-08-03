//! Detects a forked child rollout's parent-history prefix (todo #247 QA
//! defect): `spawn_agent(fork_turns: "all")` seeds the child's rollout with a
//! copy of the parent's own history, so `rollout_reader::read_rollout_items`
//! would otherwise nest the parent's own commentary inside the child's
//! sub-agent card. Split out of `rollout_reader.rs` to keep that file under
//! the 300-line ceiling.

use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
struct ForkLine {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    payload: Option<ForkPayload>,
}

#[derive(Debug, Default, Deserialize)]
struct ForkPayload {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    forked_from_id: Option<String>,
    #[serde(default)]
    agent_path: Option<String>,
    #[serde(default)]
    recipient: Option<String>,
}

/// First line (0-based, into `lines`) of the child's own transcript, or `None`
/// to process every line unchanged — either because the rollout isn't a fork,
/// or (defensively) because it is one but no `NEW_TASK` handoff marker was
/// found. Silently emptying a card is worse than the leak, so an ambiguous
/// fork falls back to the pre-fix behavior rather than dropping everything.
pub(crate) fn forked_child_start_line(lines: &[&str]) -> Option<usize> {
    let meta = first_session_meta(lines)?;
    let agent_path = forked_agent_path(&meta)?;
    find_new_task_handoff(lines, &agent_path)
}

fn first_session_meta(lines: &[&str]) -> Option<ForkPayload> {
    lines.iter().find_map(|line| {
        let rec: ForkLine = serde_json::from_str(line).ok()?;
        if rec.kind.as_deref() != Some("session_meta") {
            return None;
        }
        rec.payload
    })
}

/// `None` when the meta isn't a fork at all. `forked_from_id` is the direct
/// signal; a mismatched `id`/`session_id` covers a rollout where that field
/// was dropped but the ids still disagree.
fn forked_agent_path(meta: &ForkPayload) -> Option<String> {
    let is_fork = meta.forked_from_id.is_some()
        || matches!((&meta.id, &meta.session_id), (Some(id), Some(sid)) if id != sid);
    if !is_fork {
        return None;
    }
    meta.agent_path.clone()
}

/// The forked-in parent history ends at the `agent_message` response_item that
/// hands this child its `NEW_TASK` — addressed to it via `recipient` ==
/// `agent_path`. Returns the index of the line right after it.
fn find_new_task_handoff(lines: &[&str], agent_path: &str) -> Option<usize> {
    lines.iter().enumerate().find_map(|(idx, line)| {
        let rec: ForkLine = serde_json::from_str(line).ok()?;
        if rec.kind.as_deref() != Some("response_item") {
            return None;
        }
        let payload = rec.payload?;
        let is_handoff = payload.kind.as_deref() == Some("agent_message")
            && payload.recipient.as_deref() == Some(agent_path);
        is_handoff.then_some(idx + 1)
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn meta_line(
        id: &str,
        session_id: &str,
        forked_from_id: Option<&str>,
        agent_path: Option<&str>,
    ) -> String {
        let mut payload = json!({ "id": id, "session_id": session_id });
        if let Some(f) = forked_from_id {
            payload["forked_from_id"] = json!(f);
        }
        if let Some(a) = agent_path {
            payload["agent_path"] = json!(a);
        }
        json!({ "type": "session_meta", "payload": payload }).to_string()
    }

    fn handoff_line(recipient: &str) -> String {
        json!({
            "type": "response_item",
            "payload": { "type": "agent_message", "author": "/root", "recipient": recipient }
        })
        .to_string()
    }

    #[test]
    fn non_forked_meta_processes_every_line() {
        let meta = meta_line("t1", "t1", None, None);
        let lines = vec![meta.as_str(), "{}"];
        assert_eq!(forked_child_start_line(&lines), None);
    }

    #[test]
    fn forked_meta_skips_up_to_the_new_task_handoff() {
        let meta = meta_line("child", "parent", Some("parent"), Some("/root/child"));
        let handoff = handoff_line("/root/child");
        let lines = vec![
            meta.as_str(),
            "leaked parent text",
            handoff.as_str(),
            "real child text",
        ];
        assert_eq!(forked_child_start_line(&lines), Some(3));
    }

    #[test]
    fn forked_meta_with_no_handoff_falls_back_to_processing_everything() {
        let meta = meta_line("child", "parent", Some("parent"), Some("/root/child"));
        let lines = vec![meta.as_str(), "no handoff here"];
        assert_eq!(forked_child_start_line(&lines), None);
    }

    #[test]
    fn forked_meta_detected_via_mismatched_id_without_forked_from_id() {
        let meta = meta_line("child", "parent", None, Some("/root/child"));
        let handoff = handoff_line("/root/child");
        let lines = vec![meta.as_str(), "leaked", handoff.as_str()];
        assert_eq!(forked_child_start_line(&lines), Some(3));
    }

    #[test]
    fn forked_meta_with_no_agent_path_falls_back_to_processing_everything() {
        let meta = meta_line("child", "parent", Some("parent"), None);
        let lines = vec![meta.as_str(), "leaked"];
        assert_eq!(forked_child_start_line(&lines), None);
    }
}
