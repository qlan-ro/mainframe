//! Todo #247 (CollabAgent sub-agent delegation): string→enum classifiers for the
//! three vocabularies the collab protocol uses. Pure, no I/O — shared by the live
//! path (`collab_card.rs`, task 15) and the reload path.

/// The `tool` field on a `collabAgentToolCall` item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollabTool {
    SpawnAgent,
    SendInput,
    ResumeAgent,
    Wait,
    CloseAgent,
    Unknown,
}

pub(crate) fn classify_collab_tool(tool: &str) -> CollabTool {
    match tool {
        "spawnAgent" => CollabTool::SpawnAgent,
        "sendInput" => CollabTool::SendInput,
        "resumeAgent" => CollabTool::ResumeAgent,
        "wait" => CollabTool::Wait,
        "closeAgent" => CollabTool::CloseAgent,
        _ => {
            tracing::debug!(module = "codex:collab", tool, "codex: unknown collab tool");
            CollabTool::Unknown
        }
    }
}

/// The `kind` field on a `subAgentActivity` item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SubAgentKind {
    Started,
    Interacted,
    Interrupted,
    Unknown,
}

pub(crate) fn classify_sub_agent_kind(kind: &str) -> SubAgentKind {
    match kind {
        "started" => SubAgentKind::Started,
        "interacted" => SubAgentKind::Interacted,
        "interrupted" => SubAgentKind::Interrupted,
        _ => {
            tracing::debug!(
                module = "codex:collab",
                kind,
                "codex: unknown subAgentActivity kind"
            );
            SubAgentKind::Unknown
        }
    }
}

/// The `status` field on a `collabAgentToolCall` item. `"interrupted"` is
/// deliberately absent here — that terminal state arrives only via a
/// `subAgentActivity` ping's `kind`, never as a collab-call status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollabCallStatus {
    InProgress,
    Completed,
    Failed,
    Unknown,
}

pub(crate) fn classify_collab_status(status: &str) -> CollabCallStatus {
    match status {
        "inProgress" => CollabCallStatus::InProgress,
        "completed" => CollabCallStatus::Completed,
        "failed" => CollabCallStatus::Failed,
        _ => {
            tracing::debug!(
                module = "codex:collab",
                status,
                "codex: unknown collab call status"
            );
            CollabCallStatus::Unknown
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_every_documented_collab_tool() {
        assert_eq!(classify_collab_tool("spawnAgent"), CollabTool::SpawnAgent);
        assert_eq!(classify_collab_tool("sendInput"), CollabTool::SendInput);
        assert_eq!(classify_collab_tool("resumeAgent"), CollabTool::ResumeAgent);
        assert_eq!(classify_collab_tool("wait"), CollabTool::Wait);
        assert_eq!(classify_collab_tool("closeAgent"), CollabTool::CloseAgent);
        assert_eq!(classify_collab_tool("notATool"), CollabTool::Unknown);
    }

    #[test]
    fn classifies_every_documented_sub_agent_kind() {
        assert_eq!(classify_sub_agent_kind("started"), SubAgentKind::Started);
        assert_eq!(
            classify_sub_agent_kind("interacted"),
            SubAgentKind::Interacted
        );
        assert_eq!(
            classify_sub_agent_kind("interrupted"),
            SubAgentKind::Interrupted
        );
        assert_eq!(classify_sub_agent_kind("paused"), SubAgentKind::Unknown);
    }

    #[test]
    fn classifies_every_documented_collab_call_status() {
        assert_eq!(
            classify_collab_status("inProgress"),
            CollabCallStatus::InProgress
        );
        assert_eq!(
            classify_collab_status("completed"),
            CollabCallStatus::Completed
        );
        assert_eq!(classify_collab_status("failed"), CollabCallStatus::Failed);
        assert_eq!(
            classify_collab_status("interrupted"),
            CollabCallStatus::Unknown
        );
    }
}
