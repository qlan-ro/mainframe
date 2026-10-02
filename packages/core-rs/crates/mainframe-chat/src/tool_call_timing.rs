use std::collections::HashMap;

use mainframe_types::chat::{ChatMessage, MessageContent, MessageContentNode};
use mainframe_types::tool_call_timing::ToolCallTiming;

#[derive(Default)]
struct Call {
    timing: Option<ToolCallTiming>,
    terminal: bool,
    session: Option<String>,
}

impl Call {
    fn merge_history(&mut self, timing: Option<ToolCallTiming>) {
        let Some(incoming) = timing.filter(ToolCallTiming::is_valid) else {
            return;
        };
        if let Some(current) = &mut self.timing {
            if current.completed_at.is_none() {
                current.completed_at = incoming
                    .completed_at
                    .filter(|end| *end >= current.started_at);
            }
        } else {
            self.timing = Some(incoming);
        }
        self.terminal |= self.timing.is_some_and(|t| t.completed_at.is_some());
    }

    fn complete(&mut self, now: u64) -> bool {
        if self.terminal {
            return false;
        }
        self.terminal = true;
        if let Some(timing) = &mut self.timing {
            timing
                .completed_at
                .get_or_insert(now.max(timing.started_at));
            return true;
        }
        false
    }
}

#[derive(Default)]
pub(crate) struct ToolTimingStore {
    calls: HashMap<String, Call>,
}

impl ToolTimingStore {
    pub(crate) fn merge_history(&mut self, messages: &mut [ChatMessage]) {
        for block in messages.iter().flat_map(|m| &m.content) {
            match block {
                MessageContent::Node(MessageContentNode::ToolUse { id, timing, .. }) => {
                    self.calls
                        .entry(id.clone())
                        .or_default()
                        .merge_history(*timing);
                }
                MessageContent::Node(MessageContentNode::ToolResult { tool_use_id, .. }) => {
                    let call = self.calls.entry(tool_use_id.clone()).or_default();
                    // History cannot timestamp the end of a retained live observation.
                    call.terminal |= call.session.is_none();
                }
                _ => {}
            }
        }
        self.apply(messages);
    }

    pub(crate) fn observe(&mut self, session: &str, blocks: &[MessageContent], now: u64) {
        for block in blocks {
            match block {
                MessageContent::Node(MessageContentNode::ToolUse { id, .. }) => {
                    let call = self.calls.entry(id.clone()).or_insert_with(|| Call {
                        timing: Some(ToolCallTiming {
                            started_at: now,
                            completed_at: None,
                        }),
                        terminal: false,
                        session: Some(session.to_owned()),
                    });
                    if call.session.is_none() && call.timing.is_some() && !call.terminal {
                        call.session = Some(session.to_owned());
                    }
                }
                MessageContent::Node(MessageContentNode::ToolResult { tool_use_id, .. }) => {
                    let call = self.calls.entry(tool_use_id.clone()).or_default();
                    if call.session.as_deref().is_none_or(|owner| owner == session) {
                        call.complete(now);
                    }
                }
                _ => {}
            }
        }
    }

    pub(crate) fn finish_session(&mut self, session: &str, now: u64) -> bool {
        self.calls.values_mut().fold(false, |changed, call| {
            let owned = call.session.as_deref() == Some(session);
            (owned && call.complete(now)) || changed
        })
    }

    pub(crate) fn apply(&self, messages: &mut [ChatMessage]) {
        for block in messages.iter_mut().flat_map(|m| &mut m.content) {
            if let MessageContent::Node(MessageContentNode::ToolUse { id, timing, .. }) = block {
                *timing = self.calls.get(id).and_then(|call| call.timing);
            }
        }
    }
}

#[cfg(test)]
mod tests;
