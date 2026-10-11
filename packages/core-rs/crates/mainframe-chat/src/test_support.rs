pub use mainframe_adapter_api::test_support::FakeSession;

pub use crate::test_support_chat::{ChatBuilder, test_chat};

mod fake_adapters;
mod fake_deps;
mod fake_events;
mod fake_paths;
mod fake_projection;
mod fake_push;
mod fake_rows;
mod fake_store;
mod fake_workspace;
pub(crate) use fake_adapters::FakeAdapterPort;
pub(crate) use fake_deps::FakeDeps;

/// An empty settings store, for fakes whose every settings read is unset.
pub fn no_settings() -> &'static mainframe_types::settings_kv::MemorySettings {
    static EMPTY: std::sync::LazyLock<mainframe_types::settings_kv::MemorySettings> =
        std::sync::LazyLock::new(Default::default);
    &EMPTY
}

/// `mainframe-chat` and `mainframe-server` both depend on `mainframe-runtime`
/// already, so the tracing capture helper lives there and is re-exported here
/// for the crate's existing `crate::test_support::LogCapture` call sites.
pub use mainframe_runtime::log_capture::LogCapture;

mod presentation;
pub use presentation::presentation_handler;

mod fake_external;
