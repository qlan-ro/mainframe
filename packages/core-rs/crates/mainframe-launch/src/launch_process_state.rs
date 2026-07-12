//! Ported from `src/launch/launch-process-state.ts`.
//!
//! Durable per-config status + recent output, kept independent of
//! `LaunchManager`'s live process map (which deletes its entry the instant the
//! child exits). Two races this closes, verbatim from the TS docstring:
//!  - a terminal status ('stopped'/'failed') would be unobservable if reads went
//!    through the process map — the exit path sets the status and deletes the
//!    entry in the same tick, so a later read would fall through to a 'stopped'
//!    default and mask a real failure;
//!  - a fast subprocess (spawn → stdout → exit within one tick) can finish before
//!    a late-attaching console pane observes the live event, so the output buffer
//!    is a durable replay source.
//!
//! Both maps are reset (not deleted) on the next `start()` of the same name, so a
//! fresh run never carries a previous run's terminal status or output.
//!
//! CONCURRENCY.tsv: `statuses` = `Arc<Mutex<HashMap<String, LaunchProcessStatus>>>`,
//! `outputBuffers` = `Arc<Mutex<HashMap<String, VecDeque<LaunchOutputEntry>>>>`.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use mainframe_types::events::LaunchStream;
use mainframe_types::launch::LaunchProcessStatus;

/// One buffered stdout/stderr chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchOutputEntry {
    pub stream: LaunchStream,
    pub data: String,
}

/// Cap on buffered output entries kept per config name.
const OUTPUT_BUFFER_CAP: usize = 200;

#[derive(Default)]
struct State {
    statuses: HashMap<String, LaunchProcessStatus>,
    output_buffers: HashMap<String, VecDeque<LaunchOutputEntry>>,
}

/// Durable status + output store, cloneable (`Arc`) so the manager's spawned
/// reader/exit tasks share the one instance.
#[derive(Clone, Default)]
pub struct LaunchProcessState {
    inner: Arc<Mutex<State>>,
}

impl LaunchProcessState {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Call at the start of a fresh run — clears any prior run's output/status.
    pub fn reset(&self, name: &str) {
        let mut state = self.lock();
        state
            .statuses
            .insert(name.to_string(), LaunchProcessStatus::Starting);
        state
            .output_buffers
            .insert(name.to_string(), VecDeque::new());
    }

    pub fn set_status(&self, name: &str, status: LaunchProcessStatus) {
        self.lock().statuses.insert(name.to_string(), status);
    }

    pub fn get_status(&self, name: &str) -> LaunchProcessStatus {
        self.lock()
            .statuses
            .get(name)
            .copied()
            .unwrap_or(LaunchProcessStatus::Stopped)
    }

    pub fn get_all_statuses(&self) -> HashMap<String, LaunchProcessStatus> {
        self.lock().statuses.clone()
    }

    pub fn buffer_output(&self, name: &str, stream: LaunchStream, data: &str) {
        let mut state = self.lock();
        let buffer = state.output_buffers.entry(name.to_string()).or_default();
        buffer.push_back(LaunchOutputEntry {
            stream,
            data: data.to_string(),
        });
        if buffer.len() > OUTPUT_BUFFER_CAP {
            buffer.pop_front();
        }
    }

    /// Buffered stdout/stderr for a config, oldest first.
    pub fn get_output_buffer(&self, name: &str) -> Vec<LaunchOutputEntry> {
        self.lock()
            .output_buffers
            .get(name)
            .map(|b| b.iter().cloned().collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_status_defaults_to_stopped() {
        let state = LaunchProcessState::new();
        assert_eq!(state.get_status("unknown"), LaunchProcessStatus::Stopped);
    }

    #[test]
    fn reset_sets_starting_and_clears_output() {
        let state = LaunchProcessState::new();
        state.buffer_output("dev", LaunchStream::Stdout, "old\n");
        state.reset("dev");
        assert_eq!(state.get_status("dev"), LaunchProcessStatus::Starting);
        assert!(state.get_output_buffer("dev").is_empty());
    }

    #[test]
    fn set_status_is_observable_after_a_terminal_transition() {
        let state = LaunchProcessState::new();
        state.reset("dev");
        state.set_status("dev", LaunchProcessStatus::Failed);
        assert_eq!(state.get_status("dev"), LaunchProcessStatus::Failed);
        assert_eq!(
            state.get_all_statuses().get("dev").copied(),
            Some(LaunchProcessStatus::Failed)
        );
    }

    #[test]
    fn buffer_output_preserves_order_and_caps_at_200() {
        let state = LaunchProcessState::new();
        for i in 0..250 {
            state.buffer_output("dev", LaunchStream::Stdout, &format!("line-{i}\n"));
        }
        let buffer = state.get_output_buffer("dev");
        assert_eq!(buffer.len(), OUTPUT_BUFFER_CAP);
        // Oldest 50 dropped; first retained entry is line-50.
        assert_eq!(buffer.first().unwrap().data, "line-50\n");
        assert_eq!(buffer.last().unwrap().data, "line-249\n");
    }
}

// PORT STATUS: src/launch/launch-process-state.ts (68 lines)
// confidence: high
// todos: 0
// notes: two HashMaps behind one Arc<Mutex> (SHARED_MAP); reset/setStatus/
// getStatus(default stopped)/getAllStatuses/bufferOutput(cap 200, drop oldest)/
// getOutputBuffer(oldest-first) mirror the TS. LaunchOutputEntry.stream reuses
// the canonical LaunchStream enum from mainframe-types::events. Cloneable so the
// manager's reader/exit tasks share one store.
