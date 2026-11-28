//! The session `FakeAdapterPort::create_session` hands out.

use mainframe_types::sync::LockExt as _;
use std::sync::Arc;

use mainframe_adapter_api::AdapterSession;
use mainframe_adapter_api::test_support::FakeSession;
use mainframe_types::adapter::SessionOptions;

use super::fake_adapters::FakeAdapterPort;

/// Records `options`, then returns `session_to_return`, or a `FakeSession`
/// over `history` when that is set.
pub(crate) fn session_for(
    adapters: &FakeAdapterPort,
    options: SessionOptions,
) -> Option<Arc<dyn AdapterSession>> {
    adapters.created_sessions.lock_recover().push(options);
    if let Some(session) = adapters.session_to_return.lock_recover().clone() {
        return Some(session);
    }
    adapters.history.lock_recover().clone().map(|history| {
        Arc::new(FakeSession {
            history,
            history_loads: Some(Arc::clone(&adapters.history_loads)),
            history_sources: adapters.history_sources.lock_recover().clone(),
            collects_files: adapters.scan.collects.lock_recover().clone(),
            spawn_ok: *adapters.spawn_ok.lock_recover(),
            ..Default::default()
        }) as Arc<dyn AdapterSession>
    })
}
