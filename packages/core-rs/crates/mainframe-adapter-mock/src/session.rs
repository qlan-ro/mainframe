use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{AdapterError, SessionSink};
use mainframe_types::adapter::{AdapterProcess, AdapterProcessStatus, SessionOptions};

use crate::fixture::{RecordedEvent, ReplayState};
use crate::history::recorded_session_id;
use crate::pump::{self, Pump};
use crate::task_bridge::TaskBridge;

/// Recordings bake the absolute project root they were captured against; fixtures
/// write this token instead so replayed paths point at the live project.
const PROJECT_PATH_PLACEHOLDER: &str = "{{PROJECT_PATH}}";

pub(crate) struct SessionState {
    pub replay: ReplayState,
    pub last_delay: i64,
    /// A recorded turn is mid-replay: its batch carries an `onResult` the pump
    /// has not dispatched yet. Prompts that arrive in that window are queued.
    pub turn_in_flight: bool,
    /// Uuids of prompts the daemon queued behind the running turn, oldest first.
    pub queued: VecDeque<String>,
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
    /// Reports replayed subagent / background-bash work to the daemon's tracker.
    /// `None` outside the daemon (unit tests, and any caller that wires no tracker).
    pub(crate) task_bridge: Option<Arc<TaskBridge>>,
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
            task_bridge: None,
            project_path: options.project_path,
            spawned: AtomicBool::new(false),
            sink: Arc::new(Mutex::new(None)),
            state: Arc::new(Mutex::new(SessionState {
                replay: ReplayState::new(events),
                last_delay: 0,
                turn_in_flight: false,
                queued: VecDeque::new(),
            })),
            source: tokio::sync::Mutex::new(ReplaySource::Ready),
        }
    }

    /// Attach the background-task bridge. Builder-style so the three constructors
    /// keep their signatures.
    pub(crate) fn with_bridge(mut self, bridge: Option<Arc<TaskBridge>>) -> Self {
        self.task_bridge = bridge;
        self
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
        let text = text.replace(PROJECT_PATH_PLACEHOLDER, &self.project_path);
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
        pump::take_interaction(&mut state, expected)
    }

    pub(crate) async fn emit(&self, batch: Vec<RecordedEvent>, base: i64) {
        let outputs = pump::apply_effects(&self.project_path, batch).await;
        let Some(sink) = self.sink() else {
            return;
        };
        self.arm_turn(&outputs);
        Pump {
            chat_id: self.id.clone(),
            project_path: self.project_path.clone(),
            state: self.state.clone(),
            sink,
            bridge: self.task_bridge.clone(),
        }
        .spawn(outputs, base);
    }

    /// A batch carrying the turn's `onResult` marks the session busy until the
    /// pump dispatches it — the window in which a prompt is queued, not replayed.
    fn arm_turn(&self, batch: &[RecordedEvent]) {
        if batch.iter().any(pump::is_result) {
            self.state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .turn_in_flight = true;
        }
    }

    /// `true` when the prompt was parked behind the running turn instead of
    /// replayed. The daemon only hands over a uuid for a send it has already
    /// marked queued, so a uuid-less send always replays.
    pub(crate) fn queue_prompt(&self, uuid: String) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.turn_in_flight {
            return false;
        }
        tracing::debug!(chat_id = %self.id, %uuid, "mock-cli queued a prompt sent mid-turn");
        state.queued.push_back(uuid);
        true
    }

    /// Drop a queued prompt; `false` when it already started or never existed.
    pub(crate) fn drop_queued_prompt(&self, uuid: &str) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let before = state.queued.len();
        state.queued.retain(|queued| queued != uuid);
        before != state.queued.len()
    }

    fn sink(&self) -> Option<Arc<dyn SessionSink>> {
        self.sink.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
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

    #[tokio::test]
    async fn fixture_project_path_placeholder_resolves_to_the_live_project() {
        let dir = tempfile::tempdir().unwrap();
        let fixture = dir.path().join("recording.ndjson");
        tokio::fs::write(
            &fixture,
            r#"{"dir":"out","method":"onMessage","args":[[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"{{PROJECT_PATH}}/index.ts"}}]],"delayMs":0}"#,
        )
        .await
        .unwrap();
        let options = SessionOptions {
            project_path: "/tmp/live-project".to_string(),
            chat_id: None,
            mainframe_chat_id: "chat-1".to_string(),
        };
        let session =
            ReplaySession::from_fixture(options, fixture, Arc::new(ReplayCache::default()));

        session.ensure_loaded().await.unwrap();

        let state = session.state.lock().unwrap();
        let file_path = state.replay.events[0].args[0][0]["input"]["file_path"].as_str();
        assert_eq!(file_path, Some("/tmp/live-project/index.ts"));
    }
}
