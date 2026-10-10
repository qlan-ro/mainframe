use mainframe_types::sync::LockExt as _;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{
    Adapter, AdapterError, AdapterSession, BoxFuture, ForkPinError, ForkPinRequest,
    PlanModeActionHandler,
};
use mainframe_types::adapter::{
    AdapterCapabilities, AdapterModel, EffortLevel, ForkSource, SessionOptions,
};
use mainframe_types::display::ToolCategories;

use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;

use crate::plan_mode_handler::MockPlanModeHandler;
use crate::session::{ReplayCache, ReplaySession};
use crate::task_bridge::TaskBridge;

#[derive(Default)]
pub struct MockCliAdapter {
    indexes: Mutex<HashMap<String, usize>>,
    cache: Arc<ReplayCache>,
    /// Present only when the daemon wired its tracker in. Without it the replay
    /// behaves exactly as before: transcripts, but no background-task events.
    tracker: Option<Arc<BackgroundTaskTracker>>,
    workflows: Option<Arc<ClaudeWorkflowStore>>,
    /// Reported by `capabilities().no_persistence`. Defaults to false; tests that
    /// need the no-persistence chat behavior opt in via `with_no_persistence`
    /// (the mock adapter must be able to report either value).
    no_persistence: bool,
    /// Whether `capabilities().fork` reports `true` and `pin_fork_point` echoes
    /// the source instead of returning `Unsupported`. Tests opt in via
    /// `with_fork_capable(true)`; the default is `false`.
    fork_capable: bool,
    /// The last `pin_fork_point` request, so tests can assert the cut the
    /// chat layer resolved.
    last_pin_request: Mutex<Option<ForkPinRequest>>,
    /// A second registration's id and name (the provider-switch e2e needs two
    /// adapters); `None` is the default `mock-cli` / "Mock CLI".
    identity: Option<(String, String)>,
}

const DEFAULT_ID: &str = "mock-cli";
const DEFAULT_NAME: &str = "Mock CLI";

impl MockCliAdapter {
    /// Build an adapter that reports replayed subagent / background-bash work to
    /// the daemon's background-task tracker, the way the Claude adapter reports
    /// the CLI's own task notifications.
    pub fn with_tracker(
        tracker: Arc<BackgroundTaskTracker>,
        workflows: Arc<ClaudeWorkflowStore>,
    ) -> Self {
        Self {
            tracker: Some(tracker),
            workflows: Some(workflows),
            ..Self::default()
        }
    }

    /// Opt the mock adapter into reporting the no-persistence capability, so
    /// integration tests can exercise both the on and off paths.
    #[cfg(test)]
    pub(crate) fn with_no_persistence(mut self, value: bool) -> Self {
        self.no_persistence = value;
        self
    }

    /// Toggle the fork capability this adapter reports (fork tests).
    pub fn with_fork_capable(mut self, fork_capable: bool) -> Self {
        self.fork_capable = fork_capable;
        self
    }

    /// Register under another id and display name, so two mock adapters can
    /// run side by side. Its recordings key comes from
    /// `E2E_RECORDING_KEY_<ID>` (upper-cased, `-` as `_`) when set, else the
    /// shared `E2E_RECORDING_KEY`.
    pub fn with_identity(mut self, id: &str, name: &str) -> Self {
        self.identity = Some((id.to_string(), name.to_string()));
        self
    }

    /// The environment variable naming this adapter's recordings key.
    pub(crate) fn recording_key_var(&self) -> Option<String> {
        let (id, _) = self.identity.as_ref()?;
        Some(format!(
            "E2E_RECORDING_KEY_{}",
            id.to_ascii_uppercase().replace('-', "_")
        ))
    }

    fn recording_key(&self) -> String {
        self.recording_key_var()
            .and_then(|var| std::env::var(var).ok())
            .or_else(|| std::env::var("E2E_RECORDING_KEY").ok())
            .unwrap_or_else(|| "session".to_string())
    }

    /// The last request `pin_fork_point` received, if any.
    #[cfg(test)]
    pub(crate) fn last_pin_request(&self) -> Option<ForkPinRequest> {
        self.last_pin_request.lock_recover().clone()
    }

    fn bridge(&self) -> Option<Arc<TaskBridge>> {
        let tracker = self.tracker.as_ref()?;
        Some(Arc::new(TaskBridge::new(
            Arc::clone(tracker),
            self.workflows.clone(),
        )))
    }
}

pub fn sanitize_key(key: &str) -> String {
    let mut sanitized = String::new();
    let mut last_dash = false;
    for character in key.chars() {
        let valid = character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-');
        let next = if valid { character } else { '-' };
        if next == '-' && last_dash {
            continue;
        }
        last_dash = next == '-';
        sanitized.push(next);
    }
    sanitized.trim_matches('-').to_string()
}

fn models() -> Vec<AdapterModel> {
    vec![
        model("claude-haiku-4-5-20251001", "Haiku 4.5", true, None),
        model(
            "claude-sonnet-4-5-20251101",
            "Sonnet 4.5",
            false,
            Some(vec![
                EffortLevel::Low,
                EffortLevel::Medium,
                EffortLevel::High,
                EffortLevel::Max,
            ]),
        ),
        model(
            "claude-opus-4-5-20251001",
            "Opus 4.5",
            false,
            Some(vec![
                EffortLevel::Low,
                EffortLevel::Medium,
                EffortLevel::High,
                EffortLevel::Xhigh,
                EffortLevel::Max,
            ]),
        ),
    ]
}

fn model(
    id: &str,
    label: &str,
    is_default: bool,
    efforts: Option<Vec<EffortLevel>>,
) -> AdapterModel {
    let capable = efforts.is_some();
    AdapterModel {
        id: id.to_string(),
        label: label.to_string(),
        description: None,
        resolved_model: None,
        context_window: None,
        is_default: is_default.then_some(true),
        is_older: None,
        group: None,
        supported_efforts: efforts,
        default_effort: capable.then_some(EffortLevel::Medium),
        supports_fast: capable.then_some(true),
        supports_ultracode: (id.contains("opus")).then_some(true),
        supports_adaptive_thinking: (id.contains("opus")).then_some(true),
        supports_personality: None,
    }
}

impl Adapter for MockCliAdapter {
    fn id(&self) -> &str {
        self.identity.as_ref().map_or(DEFAULT_ID, |(id, _)| id)
    }
    fn name(&self) -> &str {
        self.identity
            .as_ref()
            .map_or(DEFAULT_NAME, |(_, name)| name)
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities {
            plan_mode: true,
            auto_mode: false,
            no_persistence: self.no_persistence,
            fork: self.fork_capable,
        }
    }
    fn is_installed(&self) -> BoxFuture<'_, Result<bool, AdapterError>> {
        Box::pin(async { Ok(true) })
    }
    fn get_version(&self) -> BoxFuture<'_, Result<Option<String>, AdapterError>> {
        Box::pin(async { Ok(Some("0.1.0".to_string())) })
    }
    fn list_models(&self) -> BoxFuture<'_, Result<Vec<AdapterModel>, AdapterError>> {
        Box::pin(async { Ok(models()) })
    }
    fn get_fallback_models(&self) -> Option<Vec<AdapterModel>> {
        Some(models())
    }

    fn create_session(&self, options: SessionOptions) -> Arc<dyn AdapterSession> {
        // An unsent fork has no session of its own yet; it replays its parent's.
        let replay_id = options.chat_id.clone().or_else(|| {
            options
                .fork_source
                .as_ref()
                .map(|source| source.source_session_id.clone())
        });
        if let Some(session_id) = replay_id.as_deref()
            && let Some(events) = self.cache.lookup(session_id)
        {
            return Arc::new(ReplaySession::new(options, events).with_bridge(self.bridge()));
        }
        let recordings_dir = match std::env::var("E2E_RECORDINGS_DIR") {
            Ok(dir) => dir,
            Err(_) => {
                return Arc::new(ReplaySession::failed(
                    options,
                    "mock-cli requires E2E_RECORDINGS_DIR".to_string(),
                ));
            }
        };
        let key = self.recording_key();
        let index = {
            let mut indexes = self.indexes.lock_recover();
            let index = *indexes.get(&key).unwrap_or(&0);
            indexes.insert(key.clone(), index + 1);
            index
        };
        let path = std::path::Path::new(&recordings_dir)
            .join(format!("{}.{index}.ndjson", sanitize_key(&key)));
        Arc::new(
            ReplaySession::from_fixture(options, path, self.cache.clone())
                .with_bridge(self.bridge()),
        )
    }

    fn kill_all(&self) {}

    fn create_plan_mode_handler(&self) -> Option<Arc<dyn PlanModeActionHandler>> {
        Some(Arc::new(MockPlanModeHandler))
    }

    fn get_tool_categories(&self) -> Option<ToolCategories> {
        Some(ToolCategories {
            explore: HashSet::from_iter(["Read", "Glob", "Grep", "LS"].map(str::to_string)),
            hidden: HashSet::new(),
            progress: HashSet::from_iter(["TaskCreate", "TaskUpdate"].map(str::to_string)),
            subagent: HashSet::from_iter(["Task", "Agent"].map(str::to_string)),
        })
    }

    fn pin_fork_point(
        &self,
        request: ForkPinRequest,
    ) -> BoxFuture<'_, Result<ForkSource, ForkPinError>> {
        *self.last_pin_request.lock_recover() = Some(request.clone());
        if !self.fork_capable {
            return Box::pin(async { Err(ForkPinError::Unsupported) });
        }
        // The mock has no turns, so `last_turn_id` carries the cut message id
        // itself; `ReplaySession::load_history` truncates the replay there.
        let source = ForkSource {
            source_session_id: request.source_session_id,
            resume_path: request.session_file_path,
            last_turn_id: request.cut.map(|cut| cut.vendor_message_id),
        };
        Box::pin(async move { Ok(source) })
    }
}

#[cfg(test)]
#[path = "adapter_tests.rs"]
mod tests;
