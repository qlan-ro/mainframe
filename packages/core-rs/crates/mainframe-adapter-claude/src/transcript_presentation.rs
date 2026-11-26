use mainframe_adapter_api::SessionSink;
use mainframe_types::sync::LockExt as _;
use mainframe_types::transcript_presentation::{
    PresentationPhase, PresentationState, PresentationTiming, PresentationUpdate,
    TranscriptPresentation,
};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub(crate) struct ClaudePresentation {
    epoch: Option<Epoch>,
    closed: HashSet<String>,
    blocked: bool,
    pending_prompt_event: Option<String>,
}
struct Epoch {
    session: String,
    context: TranscriptPresentation,
    sources: HashMap<String, Vec<String>>,
    terminal: Option<String>,
    prompt_event: Option<String>,
}

pub(crate) fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str().filter(|s| !s.is_empty())
}

impl ClaudePresentation {
    pub(crate) fn observe(
        &mut self,
        event: &Value,
        api_id: Option<&str>,
        source: Option<&str>,
        stop: Option<&str>,
        sink: &dyn SessionSink,
    ) -> Option<TranscriptPresentation> {
        let (Some(session), Some(id)) = (text(event, "session_id"), api_id) else {
            self.invalidate(sink);
            return None;
        };
        if self.closed.contains(id) {
            self.invalidate(sink);
            return None;
        }
        if self.epoch.is_none() {
            let mut epoch = Epoch::new(session, id, self.blocked);
            epoch.prompt_event = self.pending_prompt_event.take();
            self.epoch = Some(epoch);
        }
        if self.epoch.as_ref().is_some_and(|e| e.session != session) {
            self.invalidate(sink);
            return None;
        }
        let epoch = self.epoch.as_mut()?;
        if epoch.terminal.as_deref().is_some_and(|terminal| {
            terminal != id || stop.is_some_and(|reason| reason != "end_turn")
        }) {
            self.invalidate(sink);
        }
        let epoch = self.epoch.as_mut()?;
        let sources = epoch.sources.entry(id.to_string()).or_default();
        if let Some(source) = source.filter(|source| !sources.iter().any(|s| s == *source)) {
            sources.push(source.to_string());
        }
        if stop == Some("end_turn") {
            epoch.terminal = Some(id.to_string());
        }
        Some(epoch.context.clone())
    }

    pub(crate) fn prompt_event(&self) -> Option<String> {
        self.epoch.as_ref()?.prompt_event.clone()
    }

    pub(crate) fn invalidate(&mut self, sink: &dyn SessionSink) {
        self.blocked = true;
        self.pending_prompt_event = None;
        if let Some(epoch) = &mut self.epoch {
            epoch.context.state = PresentationState::Invalid;
            sink.on_presentation_update(PresentationUpdate {
                presentation: epoch.context.clone(),
                source_message_ids: None,
            });
        }
    }

    pub(crate) fn finish(&mut self, event: &Value, sink: &dyn SessionSink) {
        self.pending_prompt_event = None;
        let Some(mut epoch) = self.epoch.take() else {
            self.blocked = false;
            return;
        };
        self.closed.extend(epoch.sources.keys().cloned());
        let success = text(event, "session_id") == Some(epoch.session.as_str())
            && text(event, "subtype") == Some("success")
            && event.get("is_error").and_then(Value::as_bool) == Some(false)
            && epoch.context.state != PresentationState::Invalid;
        let final_sources = epoch.terminal.as_ref().and_then(|id| epoch.sources.get(id));
        epoch.context.state = if success && final_sources.is_some_and(|s| !s.is_empty()) {
            PresentationState::Completed
        } else {
            PresentationState::Invalid
        };
        if epoch.context.state == PresentationState::Completed {
            epoch.context.timing = event
                .get("duration_ms")
                .and_then(Value::as_u64)
                .filter(|ms| *ms <= 9_007_199_254_740_991)
                .map(|duration| PresentationTiming {
                    started_at_ms: None,
                    completed_at_ms: None,
                    duration_ms: Some(duration),
                });
        }
        sink.on_presentation_update(PresentationUpdate {
            presentation: epoch.context.clone(),
            source_message_ids: None,
        });
        if epoch.context.state == PresentationState::Completed {
            epoch.context.phase = Some(PresentationPhase::FinalAnswer);
            epoch.context.final_eligible = true;
            sink.on_presentation_update(PresentationUpdate {
                presentation: epoch.context,
                source_message_ids: final_sources.cloned(),
            });
        }
        self.blocked = false;
    }
}

impl Epoch {
    fn new(session: &str, id: &str, invalid: bool) -> Self {
        Self {
            session: session.to_string(),
            sources: HashMap::new(),
            terminal: None,
            prompt_event: None,
            context: TranscriptPresentation {
                version: 1,
                provider: "claude".to_string(),
                turn_id: serde_json::json!([session, id]).to_string(),
                parent_tool_use_id: None,
                phase: Some(PresentationPhase::Work),
                state: if invalid {
                    PresentationState::Invalid
                } else {
                    PresentationState::Running
                },
                final_eligible: false,
                timing: None,
            },
        }
    }
}

pub(crate) fn observe_user(
    session: &crate::session::ClaudeSession,
    event: &Value,
    sink: &dyn SessionSink,
) {
    if text(event, "parent_tool_use_id").is_some() {
        return;
    }
    let tool_only = event
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
        .is_some_and(|blocks| {
            !blocks.is_empty()
                && blocks
                    .iter()
                    .all(|b| text(b, "type") == Some("tool_result"))
        });
    let replay = ["isReplay", "is_replay"]
        .iter()
        .any(|key| event.get(key).and_then(Value::as_bool) == Some(true));
    let mut state = session.state.lock_recover();
    if !tool_only && !replay {
        state.presentation.pending_prompt_event = if state.presentation.epoch.is_none() {
            crate::history::history_prompt_groups::notification_summary(event)
        } else {
            None
        };
    }
    if replay || (!tool_only && state.presentation.epoch.is_some()) {
        state.presentation.invalidate(sink);
    }
}
