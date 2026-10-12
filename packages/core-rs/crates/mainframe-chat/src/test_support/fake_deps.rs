//! The one `ChatManagerDeps` double every chat test builds on: one fake per
//! capability (`store`, `paths`, `emitter`, `push`, `adapters`, `workspace`),
//! composed here, each configured through its own public fields.

use mainframe_types::sync::LockExt as _;
use std::sync::Arc;

use mainframe_adapter_api::{AdapterSession, ForkPinRequest};
use mainframe_services::workspace::WorktreeEntry;
use mainframe_types::adapter::{AdapterInfo, SessionOptions};
use mainframe_types::chat::{Chat, ChatMessage};
use mainframe_types::events::DaemonEvent;
use mainframe_types::settings_kv::{MemorySettings, SettingsKv};

use super::fake_adapters::{FakeAdapterPort, PinFailure};
use super::fake_events::FakeEventEmitter;
use super::fake_paths::FakeProjectPaths;
use super::fake_push::FakePusher;
use super::fake_store::FakeChatStore;
use super::fake_workspace::FakeWorkspacePort;
use crate::chat_manager::{ChatManagerDeps, ForkCreateInput};
use crate::fork::PendingForkState;
use crate::segments::SegmentStore;

#[derive(Default)]
pub(crate) struct FakeDeps {
    pub(crate) store: FakeChatStore,
    pub(crate) external_sessions: std::sync::Mutex<Vec<mainframe_types::adapter::ExternalSession>>,
    pub(crate) paths: FakeProjectPaths,
    pub(crate) emitter: FakeEventEmitter,
    pub(crate) push: FakePusher,
    pub(crate) adapters: FakeAdapterPort,
    pub(crate) workspace: FakeWorkspacePort,
    /// The settings rows `settings()` serves; empty unless a test adds rows.
    pub(crate) settings: MemorySettings,
    pub(crate) settings_calls: std::sync::atomic::AtomicUsize,
}

impl FakeDeps {
    pub(crate) fn arc() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub(crate) fn with_chats(chats: Vec<Chat>) -> Arc<Self> {
        let deps = Self::default();
        for chat in chats {
            deps.store.insert(chat);
        }
        Arc::new(deps)
    }

    pub(crate) fn events(&self) -> Vec<DaemonEvent> {
        self.emitter.events()
    }
    pub(crate) fn clear_events(&self) {
        self.emitter.events.lock_recover().clear();
    }
    pub(crate) fn set_project_path(&self, path: &str) {
        *self.paths.project_path.lock_recover() = Some(path.to_string());
    }
    pub(crate) fn set_listing(&self, entries: Vec<WorktreeEntry>) {
        *self.workspace.listing.lock_recover() = entries;
    }
    pub(crate) fn list_calls(&self) -> usize {
        self.workspace
            .list_calls
            .load(std::sync::atomic::Ordering::SeqCst)
    }
    pub(crate) fn dismiss_writes(&self) -> Vec<(String, String)> {
        self.store.dismiss_writes.lock_recover().clone()
    }
    pub(crate) fn order(&self) -> Vec<String> {
        self.workspace.order.lock_recover().clone()
    }
    pub(crate) fn created_sessions(&self) -> Vec<SessionOptions> {
        self.adapters.created_sessions.lock_recover().clone()
    }
    pub(crate) fn set_spawn_ok(&self, ok: bool) {
        *self.adapters.spawn_ok.lock_recover() = ok;
    }
    pub(crate) fn set_session_to_return(&self, session: Arc<dyn AdapterSession>) {
        *self.adapters.session_to_return.lock_recover() = Some(session);
    }
    pub(crate) fn set_fork_capable(&self, fork: bool) {
        *self.adapters.fork_capable.lock_recover() = fork;
    }
    pub(crate) fn set_fork_unavailable_reason(&self, reason: &str) {
        *self.adapters.fork_unavailable_reason.lock_recover() = Some(reason.to_string());
    }
    pub(crate) fn fail_pin(&self, message: &str) {
        *self.adapters.pin_failure.lock_recover() = Some(PinFailure::Failed(message.to_string()));
    }
    pub(crate) fn fail_pin_transcript_missing(&self) {
        *self.adapters.pin_failure.lock_recover() = Some(PinFailure::TranscriptMissing);
    }
    pub(crate) fn fail_pin_unsupported(&self) {
        *self.adapters.pin_failure.lock_recover() = Some(PinFailure::Unsupported);
    }
    pub(crate) fn fail_pin_point_not_found(&self, reason: &str) {
        *self.adapters.pin_failure.lock_recover() =
            Some(PinFailure::PointNotFound(reason.to_string()));
    }
    pub(crate) fn fork_inserts(&self) -> Vec<ForkCreateInput> {
        self.store.fork_inserts.lock_recover().clone()
    }
    pub(crate) fn pin_requests(&self) -> Vec<ForkPinRequest> {
        self.adapters.pin_requests.lock_recover().clone()
    }
    pub(crate) fn set_history(&self, history: Vec<ChatMessage>) {
        *self.adapters.history.lock_recover() = Some(history);
    }
    pub(crate) fn fail_create_fork(&self, message: &str) {
        *self.store.create_fork_failure.lock_recover() = Some(message.to_string());
    }
    pub(crate) fn set_pending_fork(&self, chat_id: &str, pending: PendingForkState) {
        self.store
            .pending_forks
            .lock_recover()
            .insert(chat_id.to_string(), pending);
    }
    pub(crate) fn chat_count(&self) -> usize {
        self.store.chats.lock_recover().len()
    }
    pub(crate) fn set_fork_snapshots_dir(&self, dir: &str) {
        *self.paths.fork_snapshots_dir.lock_recover() = Some(dir.to_string());
    }
    pub(crate) fn set_history_sources(&self, sources: Vec<std::path::PathBuf>) {
        *self.adapters.history_sources.lock_recover() = sources;
    }
    pub(crate) fn set_segment_store(&self, store: Arc<dyn SegmentStore>) {
        /* expected */
        let _ = self.store.segment_store.set(store); // First attachment wins.
    }
    pub(crate) fn set_adapter_info(&self, info: AdapterInfo) {
        self.adapters
            .adapter_infos
            .lock_recover()
            .insert(info.id.clone(), info);
    }
    pub(crate) fn set_history_cache_dir(&self, dir: &str) {
        *self.paths.history_cache_dir.lock_recover() = Some(dir.to_string());
    }
}

impl ChatManagerDeps for FakeDeps {
    fn settings(&self) -> &dyn SettingsKv {
        self.settings_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        &self.settings
    }
}
