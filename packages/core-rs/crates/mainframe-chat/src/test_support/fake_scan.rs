//! The scan side of [`FakeAdapterPort`]: the files each history read collects,
//! and what every `scan_loaded_history` call was handed.
use std::sync::Mutex;

use mainframe_adapter_api::{BoxFuture, CollectedHistoryFiles};
use mainframe_types::sync::LockExt as _;

use super::fake_adapters::FakeAdapterPort;

#[derive(Default)]
pub(crate) struct FakeScan {
    /// What each created session's `load_history` collects (`FakeSession::collects_files`).
    pub(crate) collects: Mutex<Option<CollectedHistoryFiles>>,
    /// The `files` every `scan_loaded_history` call was handed, in order.
    pub(crate) scanned: Mutex<Vec<Option<CollectedHistoryFiles>>>,
}

impl FakeAdapterPort {
    /// `scan_loaded_history`: records `files`, then waits on `scan_gate` when a test set one.
    pub(crate) fn scan(&self, files: Option<CollectedHistoryFiles>) -> BoxFuture<'_, ()> {
        self.scan.scanned.lock_recover().push(files);
        let gate = self.scan_gate.lock_recover().clone();
        Box::pin(async move {
            self.scan_started.notify_one();
            if let Some(gate) = gate {
                gate.notified().await;
            }
        })
    }
}
