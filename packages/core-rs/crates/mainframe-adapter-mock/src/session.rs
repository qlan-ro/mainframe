use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mainframe_adapter_api::{AdapterError, SessionSink};
use mainframe_types::adapter::{AdapterProcess, AdapterProcessStatus, SessionOptions};

use crate::dispatch::emit_event;
use crate::fixture::{EventDirection, RecordedEvent, ReplayState};
use crate::history::recorded_session_id;

const MAX_DELAY_MS: u64 = 120;

pub(crate) struct SessionState {
    pub replay: ReplayState,
    pub last_delay: i64,
}

#[derive(Default)]
struct ReplayCacheState {
    by_session_id: HashMap<String, Vec<RecordedEvent>>,
    last_live_events: Option<Vec<RecordedEvent>>,
}

#[derive(Default)]
pub(crate) struct ReplayCache {
    state: Mutex<ReplayCacheState>,
}

impl ReplayCache {
    pub fn lookup(&self, session_id: &str) -> Option<Vec<RecordedEvent>> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state
            .by_session_id
            .get(session_id)
            .cloned()
            .or_else(|| state.last_live_events.clone())
    }

    fn store(&self, events: &[RecordedEvent]) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.last_live_events = Some(events.to_vec());
        if let Some(session_id) = recorded_session_id(events) {
            state.by_session_id.insert(session_id, events.to_vec());
        }
    }
}

enum ReplaySource {
    Ready,
    Fixture {
        path: PathBuf,
        cache: Arc<ReplayCache>,
    },
    Failed(String),
}

pub struct ReplaySession {
    pub(crate) id: String,
    pub(crate) project_path: String,
    pub(crate) spawned: AtomicBool,
    pub(crate) sink: Arc<Mutex<Option<Arc<dyn SessionSink>>>>,
    pub(crate) state: Arc<Mutex<SessionState>>,
    source: tokio::sync::Mutex<ReplaySource>,
}

impl ReplaySession {
    pub fn new(options: SessionOptions, events: Vec<RecordedEvent>) -> Self {
        Self {
            id: options.mainframe_chat_id,
            project_path: options.project_path,
            spawned: AtomicBool::new(false),
            sink: Arc::new(Mutex::new(None)),
            state: Arc::new(Mutex::new(SessionState {
                replay: ReplayState::new(events),
                last_delay: 0,
            })),
            source: tokio::sync::Mutex::new(ReplaySource::Ready),
        }
    }

    pub(crate) fn from_fixture(
        options: SessionOptions,
        path: PathBuf,
        cache: Arc<ReplayCache>,
    ) -> Self {
        let mut session = Self::new(options, Vec::new());
        session.source = tokio::sync::Mutex::new(ReplaySource::Fixture { path, cache });
        session
    }

    pub(crate) fn failed(options: SessionOptions, message: String) -> Self {
        let mut session = Self::new(options, Vec::new());
        session.source = tokio::sync::Mutex::new(ReplaySource::Failed(message));
        session
    }

    pub(crate) async fn ensure_loaded(&self) -> Result<(), AdapterError> {
        let mut source = self.source.lock().await;
        match &*source {
            ReplaySource::Ready => return Ok(()),
            ReplaySource::Failed(message) => return Err(AdapterError::Message(message.clone())),
            ReplaySource::Fixture { .. } => {}
        }
        let ReplaySource::Fixture { path, cache } = &*source else {
            return Ok(());
        };
        let path = path.clone();
        let cache = cache.clone();
        let text = tokio::fs::read_to_string(&path).await.map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                AdapterError::Message(format!(
                    "mock-cli: fixture not found: {} — add or generate the NDJSON fixture",
                    path.display()
                ))
            } else {
                AdapterError::Io(error)
            }
        })?;
        let events = crate::parse_fixture(&text)?;
        cache.store(&events);
        self.state.lock().unwrap_or_else(|e| e.into_inner()).replay = ReplayState::new(events);
        *source = ReplaySource::Ready;
        Ok(())
    }

    pub(crate) fn process_info(&self) -> AdapterProcess {
        AdapterProcess {
            id: self.id.clone(),
            adapter_id: "mock-cli".to_string(),
            chat_id: self.id.clone(),
            pid: -1,
            status: AdapterProcessStatus::Ready,
            project_path: self.project_path.clone(),
            model: None,
        }
    }

    pub(crate) async fn advance(&self, expected: &str) {
        let (batch, base, error) = self.take_interaction(expected);
        if let Some(message) = error {
            if let Some(sink) = self.sink() {
                sink.on_error(AdapterError::Message(message));
            }
            return;
        }
        self.emit(batch, base).await;
    }

    fn take_interaction(&self, expected: &str) -> (Vec<RecordedEvent>, i64, Option<String>) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
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

    pub(crate) async fn emit(&self, batch: Vec<RecordedEvent>, base: i64) {
        let mut outputs = Vec::new();
        for event in batch {
            if event.dir == EventDirection::Fx {
                if let Err(error) = apply_file_effects(&self.project_path, &event).await {
                    tracing::warn!(?error, "mock-cli failed to apply recorded file effect");
                }
                continue;
            }
            outputs.push(event);
        }
        let Some(sink) = self.sink() else {
            return;
        };
        tokio::spawn(async move {
            let started_at = tokio::time::Instant::now();
            for event in outputs {
                let target = Duration::from_millis(
                    event
                        .delay_ms
                        .saturating_sub(base)
                        .clamp(0, MAX_DELAY_MS as i64) as u64,
                );
                if let Some(remaining) = target.checked_sub(started_at.elapsed()) {
                    tokio::time::sleep(remaining).await;
                }
                emit_event(sink.clone(), event);
            }
        });
    }

    fn sink(&self) -> Option<Arc<dyn SessionSink>> {
        self.sink.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
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
    use mainframe_adapter_api::AdapterSession;

    #[tokio::test]
    async fn missing_fixture_fails_spawn_with_path() {
        let options = SessionOptions {
            project_path: "/tmp/project".to_string(),
            chat_id: None,
            mainframe_chat_id: "chat-1".to_string(),
        };
        let session = ReplaySession::from_fixture(
            options,
            PathBuf::from("/tmp/missing-recording.ndjson"),
            Arc::new(ReplayCache::default()),
        );

        let error = session.spawn(None, None).await.unwrap_err();

        assert!(error.to_string().contains("/tmp/missing-recording.ndjson"));
        assert!(error.to_string().contains("fixture not found"));
    }
}
