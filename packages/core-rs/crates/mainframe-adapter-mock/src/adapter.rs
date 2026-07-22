use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{Adapter, AdapterError, AdapterSession, BoxFuture};
use mainframe_types::adapter::{AdapterCapabilities, AdapterModel, EffortLevel, SessionOptions};
use mainframe_types::display::ToolCategories;

use crate::session::{ReplayCache, ReplaySession};

#[derive(Default)]
pub struct MockCliAdapter {
    indexes: Mutex<HashMap<String, usize>>,
    cache: Arc<ReplayCache>,
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
        "mock-cli"
    }
    fn name(&self) -> &str {
        "Mock CLI"
    }
    fn capabilities(&self) -> AdapterCapabilities {
        AdapterCapabilities { plan_mode: true }
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
        if let Some(session_id) = options.chat_id.as_deref()
            && let Some(events) = self.cache.lookup(session_id)
        {
            return Arc::new(ReplaySession::new(options, events));
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
        let key = std::env::var("E2E_RECORDING_KEY").unwrap_or_else(|_| "session".to_string());
        let index = {
            let mut indexes = self.indexes.lock().unwrap_or_else(|e| e.into_inner());
            let index = *indexes.get(&key).unwrap_or(&0);
            indexes.insert(key.clone(), index + 1);
            index
        };
        let path = std::path::Path::new(&recordings_dir)
            .join(format!("{}.{index}.ndjson", sanitize_key(&key)));
        Arc::new(ReplaySession::from_fixture(
            options,
            path,
            self.cache.clone(),
        ))
    }

    fn kill_all(&self) {}

    fn get_tool_categories(&self) -> Option<ToolCategories> {
        Some(ToolCategories {
            explore: HashSet::from_iter(["Read", "Glob", "Grep", "LS"].map(str::to_string)),
            hidden: HashSet::new(),
            progress: HashSet::from_iter(["TaskCreate", "TaskUpdate"].map(str::to_string)),
            subagent: HashSet::from_iter(["Task", "Agent"].map(str::to_string)),
        })
    }
}
