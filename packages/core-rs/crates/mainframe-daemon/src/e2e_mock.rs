//! The replay adapters `E2E_MODE=mock` registers. Specs opt into extras by
//! env flag: `E2E_MOCK_FORK=1` makes the mock fork-capable, and
//! `E2E_MOCK_SWITCH=1` adds a second mock (`mock-cli-b`) so a chat can switch
//! providers in place.

use std::sync::Arc;

use mainframe_adapter_mock::MockCliAdapter;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;

pub const SECOND_MOCK_ID: &str = "mock-cli-b";
pub const SECOND_MOCK_NAME: &str = "Mock CLI B";

/// The mock adapters to register, given an env lookup (injected for tests).
pub fn mock_adapters(
    tracker: &Arc<BackgroundTaskTracker>,
    workflows: &Arc<ClaudeWorkflowStore>,
    env: impl Fn(&str) -> Option<String>,
) -> Vec<MockCliAdapter> {
    let flag = |name: &str| env(name).as_deref() == Some("1");
    let build = || MockCliAdapter::with_tracker(Arc::clone(tracker), Arc::clone(workflows));
    let mut adapters = vec![build().with_fork_capable(flag("E2E_MOCK_FORK"))];
    if flag("E2E_MOCK_SWITCH") {
        adapters.push(build().with_identity(SECOND_MOCK_ID, SECOND_MOCK_NAME));
    }
    adapters
}

#[cfg(test)]
mod tests {
    use mainframe_adapter_api::Adapter;

    use super::*;

    fn ids(env: &[(&str, &str)]) -> Vec<(String, bool)> {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let workflows = Arc::new(ClaudeWorkflowStore::new());
        let lookup = |name: &str| {
            env.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string())
        };
        mock_adapters(&tracker, &workflows, lookup)
            .iter()
            .map(|a| (a.id().to_string(), a.capabilities().fork))
            .collect()
    }

    #[test]
    fn the_default_registers_one_fork_incapable_mock() {
        assert_eq!(ids(&[]), [("mock-cli".to_string(), false)]);
    }

    #[test]
    fn the_fork_flag_makes_the_mock_fork_capable() {
        assert_eq!(
            ids(&[("E2E_MOCK_FORK", "1")]),
            [("mock-cli".to_string(), true)]
        );
    }

    #[test]
    fn the_switch_flag_adds_a_second_mock() {
        assert_eq!(
            ids(&[("E2E_MOCK_SWITCH", "1")]),
            [
                ("mock-cli".to_string(), false),
                (SECOND_MOCK_ID.to_string(), false)
            ]
        );
    }
}
