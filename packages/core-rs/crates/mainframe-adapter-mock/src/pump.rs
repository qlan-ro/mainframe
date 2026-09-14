//! Walks a recorded batch onto the sink, then hands the turn to whichever prompt
//! the daemon queued behind it. Split out of `session.rs`: the hand-off runs
//! inside the spawned replay task, so it cannot borrow the session.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mainframe_adapter_api::{AdapterError, SessionSink};

use crate::dispatch::emit_event;
use crate::fixture::{EventDirection, RecordedEvent, ReplayState};
use crate::session::SessionState;
use crate::task_bridge::TaskBridge;

const MAX_DELAY_MS: u64 = 120;

/// Per-event replay delay ceiling. Defaults to `MAX_DELAY_MS` so the suite stays
/// fast, but `E2E_MOCK_MAX_DELAY_MS` widens it for the rare test that must observe
/// a transient state (e.g. the sidebar 'working' dot) whose window would otherwise
/// collapse into the ~120ms burst and race a debounced client refetch.
fn max_delay_ms() -> i64 {
    std::env::var("E2E_MOCK_MAX_DELAY_MS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|v| *v >= 0)
        .unwrap_or(MAX_DELAY_MS as i64)
}

pub(crate) fn is_result(event: &RecordedEvent) -> bool {
    event.dir == EventDirection::Out && event.method == "onResult"
}

pub(crate) struct Pump {
    pub chat_id: String,
    pub project_path: String,
    pub state: Arc<Mutex<SessionState>>,
    pub sink: Arc<dyn SessionSink>,
    pub bridge: Option<Arc<TaskBridge>>,
}

impl Pump {
    pub fn spawn(self, batch: Vec<RecordedEvent>, base: i64) {
        tokio::spawn(async move { self.run(batch, base).await });
    }

    async fn run(self, mut batch: Vec<RecordedEvent>, mut base: i64) {
        loop {
            // Only the batch carrying the turn's `onResult` owns the hand-off:
            // spawn drains and permission batches replay concurrently with it and
            // must not dequeue a prompt the running turn still owes an ack.
            let owns_turn = batch.iter().any(is_result);
            self.play(batch, base).await;
            if !owns_turn {
                return;
            }
            let Some(next) = self.next_queued_turn() else {
                return;
            };
            match next {
                Ok((events, next_base)) => {
                    batch = apply_effects(&self.project_path, events).await;
                    base = next_base;
                }
                Err(message) => {
                    self.sink.on_error(AdapterError::Message(message));
                    return;
                }
            }
        }
    }

    async fn play(&self, batch: Vec<RecordedEvent>, base: i64) {
        let ceiling = max_delay_ms();
        let started_at = tokio::time::Instant::now();
        for event in batch {
            let target =
                Duration::from_millis(event.delay_ms.saturating_sub(base).clamp(0, ceiling) as u64);
            if let Some(remaining) = target.checked_sub(started_at.elapsed()) {
                tokio::time::sleep(remaining).await;
            }
            // Start/end the task BEFORE the message lands, so the Activity
            // panel and the transcript card appear on the same frame.
            if let Some(bridge) = self.bridge.as_ref() {
                bridge.observe(&self.chat_id, &event);
            }
            emit_event(self.sink.clone(), event);
        }
    }

    /// The turn just ended: dequeue the oldest prompt the daemon parked behind it,
    /// ack it the way the CLI's `isReplay` user event does, and take its recorded
    /// turn. `None` leaves the session idle.
    fn next_queued_turn(&self) -> Option<Result<(Vec<RecordedEvent>, i64), String>> {
        let (uuid, batch, base, error) = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if !state.turn_in_flight {
                return None;
            }
            let uuid = match state.queued.pop_front() {
                Some(uuid) => uuid,
                None => {
                    state.turn_in_flight = false;
                    return None;
                }
            };
            let (batch, base, error) = take_interaction(&mut state, "sendMessage");
            state.turn_in_flight = error.is_none() && batch.iter().any(is_result);
            (uuid, batch, base, error)
        };
        tracing::debug!(chat_id = %self.chat_id, %uuid, "mock-cli starting a queued prompt's turn");
        self.sink.on_queued_processed(&uuid);
        Some(match error {
            Some(message) => Err(message),
            None => Ok((batch, base)),
        })
    }
}

pub(crate) fn take_interaction(
    state: &mut SessionState,
    expected: &str,
) -> (Vec<RecordedEvent>, i64, Option<String>) {
    // A permission answer past the end of the recording is a no-op, not a
    // desync: the real CLI drops a `control_response` whose request it has
    // already resolved, and recordings routinely stop at the last gate they
    // opened (the answer to it was never recorded). Failing the whole run on
    // one instead cost the v2.0.0 release a red e2e gate. Same tolerance the
    // in-recording duplicate below gets — plan-approval.0.ndjson carries two
    // identical `respondToPermission` markers because the daemon really does
    // forward an ExitPlanMode allow twice (permission_handler forwards, then
    // the plan-mode escalation forwards the same response again).
    if expected == "respondToPermission" && state.replay.is_exhausted() {
        tracing::debug!("mock-cli: ignoring a respondToPermission past the end of the fixture");
        return (Vec::new(), state.last_delay, None);
    }
    let mut prefix = if expected == "interrupt" {
        if !state.replay.peek_input("interrupt") {
            return (Vec::new(), state.last_delay, None);
        }
        Vec::new()
    } else {
        state.replay.drain_optional_interrupts()
    };
    let marker = state.replay.consume_input();
    if marker.as_ref().map(|event| event.method.as_str()) != Some(expected) {
        let message = desync_message(expected, marker, &state.replay);
        return (Vec::new(), state.last_delay, Some(message));
    }
    let Some(marker) = marker else {
        return (Vec::new(), state.last_delay, None);
    };
    state.last_delay = marker.delay_ms;
    while state.replay.peek_input(expected) {
        state.replay.consume_input();
    }
    prefix.extend(state.replay.drain_outputs());
    let base = state.last_delay;
    if let Some(last) = prefix.last() {
        state.last_delay = last.delay_ms;
    }
    (prefix, base, None)
}

fn desync_message(expected: &str, marker: Option<RecordedEvent>, state: &ReplayState) -> String {
    let had = if let Some(marker) = marker {
        format!("'{}'", marker.method)
    } else if state.is_exhausted() {
        "nothing (fixture exhausted)".to_string()
    } else {
        let method = state
            .events
            .get(state.cursor)
            .map(|event| event.method.as_str())
            .unwrap_or("unknown");
        format!("an out-event ('{method}') — fixture is mid-turn")
    };
    format!(
        "mock-cli: expected an '{expected}' marker but the fixture had {had} — the test drives a different interaction order than was recorded. Re-record."
    )
}

/// Write the batch's recorded file effects and return the events left to emit.
pub(crate) async fn apply_effects(
    project_path: &str,
    batch: Vec<RecordedEvent>,
) -> Vec<RecordedEvent> {
    let mut outputs = Vec::new();
    for event in batch {
        if event.dir == EventDirection::Fx {
            if let Err(error) = apply_file_effects(project_path, &event).await {
                tracing::warn!(?error, "mock-cli failed to apply recorded file effect");
            }
            continue;
        }
        outputs.push(event);
    }
    outputs
}

async fn apply_file_effects(project_path: &str, event: &RecordedEvent) -> std::io::Result<()> {
    for file in &event.files {
        let path = Path::new(project_path).join(&file.path);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(path, &file.content).await?;
    }
    for deleted in &event.deleted {
        let path = PathBuf::from(project_path).join(deleted);
        match tokio::fs::remove_file(path).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    fn exhausted_state() -> SessionState {
        SessionState {
            replay: ReplayState::new(Vec::new()),
            last_delay: 0,
            turn_in_flight: false,
            queued: VecDeque::new(),
        }
    }

    #[test]
    fn a_permission_answer_past_the_end_of_the_fixture_is_ignored() {
        let (batch, _, error) = take_interaction(&mut exhausted_state(), "respondToPermission");

        assert!(batch.is_empty());
        assert_eq!(error, None);
    }

    #[test]
    fn a_message_past_the_end_of_the_fixture_still_reports_a_desync() {
        let (_, _, error) = take_interaction(&mut exhausted_state(), "sendMessage");

        let message = error.expect("an exhausted fixture must still fail a sendMessage");
        assert!(message.contains("fixture exhausted"), "{message}");
    }
}
