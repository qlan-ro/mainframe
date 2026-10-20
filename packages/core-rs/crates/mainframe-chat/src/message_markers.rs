#[cfg(test)]
pub(crate) use mainframe_types::message_markers::{
    strip_reference_lines, strip_sandbox_capture_block,
};

pub(crate) fn visible_message_text(text: &str) -> String {
    mainframe_types::message_markers::visible_prose_text(&unwrap_agent_message(text))
}

// ── Agent messages ──────────────────────────────────────────────────────────

const AGENT_MESSAGE_OPEN: &str = "<mainframe-agent-message ";
const AGENT_MESSAGE_CLOSE: &str = "</mainframe-agent-message>";

/// The body of a whole-message agent marker (`chat_launch` and `chat_send`
/// prompts from the orchestration MCP server), so a chat an agent launched is
/// titled after the prompt, not the marker. Anything else passes through
/// unchanged.
pub(crate) fn unwrap_agent_message(text: &str) -> String {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix(AGENT_MESSAGE_OPEN) else {
        return text.to_string();
    };
    let (Some(header_end), true) = (rest.find('>'), rest.ends_with(AGENT_MESSAGE_CLOSE)) else {
        return text.to_string();
    };
    let body = &rest[header_end + 1..rest.len() - AGENT_MESSAGE_CLOSE.len()];
    body.trim().to_string()
}

#[cfg(test)]
#[path = "message_markers_tests.rs"]
mod tests;
