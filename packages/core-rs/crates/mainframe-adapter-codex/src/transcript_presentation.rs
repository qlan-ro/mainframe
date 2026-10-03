use crate::presentation_fields::{ProviderTiming, agent_phase};
use mainframe_adapter_api::SessionSink;
use mainframe_types::transcript_presentation::*;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct PresentationStateByThread {
    turns: HashMap<String, Turn>,
}
#[derive(Debug)]
struct Turn {
    id: String,
    context: TranscriptPresentation,
    items: HashMap<String, Item>,
}
#[derive(Debug)]
struct Item {
    context: TranscriptPresentation,
    delivered: bool,
}

pub(crate) fn context(
    thread: &str,
    turn: &str,
    parent: Option<String>,
    status: &str,
    timing: &ProviderTiming,
) -> Option<TranscriptPresentation> {
    if thread.is_empty() || turn.is_empty() {
        return None;
    }
    Some(TranscriptPresentation {
        version: 1,
        provider: "codex".into(),
        turn_id: serde_json::json!([thread, turn]).to_string(),
        parent_tool_use_id: parent,
        phase: None,
        state: turn_state(status),
        final_eligible: false,
        timing: timing.normalized(),
    })
}
pub(crate) fn turn_state(status: &str) -> PresentationState {
    match status {
        "inProgress" => PresentationState::Running,
        "completed" => PresentationState::Completed,
        "interrupted" => PresentationState::Cancelled,
        "failed" => PresentationState::Failed,
        _ => PresentationState::Unknown,
    }
}
pub(crate) fn item_phase(item: &Value) -> (Option<PresentationPhase>, bool) {
    match item.get("type").and_then(Value::as_str) {
        Some("agentMessage") => serde_json::from_value(item.clone())
            .map(|m| agent_phase(&m))
            .unwrap_or((None, false)),
        Some("userMessage" | "contextCompaction") | None => (None, false),
        Some(_) => (Some(PresentationPhase::Work), false),
    }
}
impl PresentationStateByThread {
    pub(crate) fn clear(&mut self) {
        // Keep invalid turn membership so late callbacks cannot revive it after exit.
        self.turns
            .retain(|_, turn| turn.context.state == PresentationState::Invalid);
    }
    pub(crate) fn invalidate_unfinished(&mut self, sink: &dyn SessionSink) {
        for turn in self.turns.values_mut() {
            if !matches!(
                turn.context.state,
                PresentationState::Running | PresentationState::Unknown
            ) {
                continue;
            }
            turn.context.state = PresentationState::Invalid;
            sink.on_presentation_update(PresentationUpdate {
                presentation: turn.context.clone(),
                source_message_ids: None,
            });
        }
    }
    pub(crate) fn start(
        &mut self,
        thread: &str,
        turn: &str,
        parent: Option<String>,
        timing: &ProviderTiming,
    ) {
        if self.turns.get(thread).is_some_and(|t| t.id == turn) {
            return;
        }
        if let Some(context) = context(thread, turn, parent, "inProgress", timing) {
            self.turns.insert(
                thread.into(),
                Turn {
                    id: turn.into(),
                    context,
                    items: HashMap::new(),
                },
            );
        }
    }
    pub(crate) fn ensure(&mut self, thread: &str, turn: &str, parent: Option<String>) {
        if self.turns.contains_key(thread) {
            return;
        }
        if let Some(context) = context(thread, turn, parent, "unknown", &ProviderTiming::default())
        {
            self.turns.insert(
                thread.into(),
                Turn {
                    id: turn.into(),
                    context,
                    items: HashMap::new(),
                },
            );
        }
    }
    pub(crate) fn item(
        &mut self,
        thread: &str,
        turn: &str,
        item: &Value,
        completed: bool,
        sink: &dyn SessionSink,
    ) -> Option<(TranscriptPresentation, bool)> {
        let current = self.turns.get_mut(thread).filter(|t| t.id == turn)?;
        let id = item.get("id")?.as_str()?.to_string();
        if id.is_empty() {
            return None;
        }
        let mut p = current.context.clone();
        (p.phase, p.final_eligible) = item_phase(item);
        let delivered = current.items.get(&id).is_some_and(|i| i.delivered);
        if let Some(previous) = current.items.get(&id) {
            if previous.context.final_eligible && !p.final_eligible {
                current.context.state = PresentationState::Invalid;
                p.state = PresentationState::Invalid;
                sink.on_presentation_update(PresentationUpdate {
                    presentation: current.context.clone(),
                    source_message_ids: None,
                });
            }
            if (!completed || previous.delivered) && p != previous.context {
                sink.on_presentation_update(PresentationUpdate {
                    presentation: p.clone(),
                    source_message_ids: Some(vec![id.clone()]),
                });
            }
        }
        let duplicate = completed
            && delivered
            && item.get("type").and_then(Value::as_str) == Some("agentMessage");
        current.items.insert(
            id,
            Item {
                context: p.clone(),
                delivered: completed || delivered,
            },
        );
        Some((p, duplicate))
    }
    pub(crate) fn partial(
        &mut self,
        thread: &str,
        turn: &str,
        id: &str,
    ) -> Option<TranscriptPresentation> {
        let current = self.turns.get_mut(thread).filter(|t| t.id == turn)?;
        let entry = current.items.entry(id.into()).or_insert_with(|| Item {
            context: current.context.clone(),
            delivered: false,
        });
        let mut p = entry.context.clone();
        p.state = current.context.state;
        p.timing = current.context.timing.clone();
        Some(p)
    }
    pub(crate) fn reconcile(
        &mut self,
        thread: &str,
        turn: &str,
        items: &[Value],
        sink: &dyn SessionSink,
    ) {
        for item in items {
            let known = self
                .turns
                .get(thread)
                .filter(|t| t.id == turn)
                .is_some_and(|t| {
                    item.get("id")
                        .and_then(Value::as_str)
                        .is_some_and(|id| t.items.contains_key(id))
                });
            if known {
                self.item(thread, turn, item, false, sink);
            }
        }
    }
    pub(crate) fn finish(
        &mut self,
        thread: &str,
        turn: &str,
        status: &str,
        timing: &ProviderTiming,
        sink: &dyn SessionSink,
    ) {
        let Some(current) = self.turns.get_mut(thread).filter(|t| t.id == turn) else {
            return;
        };
        if matches!(
            current.context.state,
            PresentationState::Running | PresentationState::Unknown
        ) {
            current.context.state = turn_state(status);
        }
        if let Some(mut next) = timing.normalized() {
            next.started_at_ms = next.started_at_ms.or(current
                .context
                .timing
                .as_ref()
                .and_then(|t| t.started_at_ms));
            if next.is_valid() {
                current.context.timing = Some(next);
            }
        }
        sink.on_presentation_update(PresentationUpdate {
            presentation: current.context.clone(),
            source_message_ids: None,
        });
    }
}
