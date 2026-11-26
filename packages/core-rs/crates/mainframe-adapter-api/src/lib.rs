//! Adapter contracts, registry, executable resolution and shared support types.
#![forbid(unsafe_code)]
#![cfg_attr(
    test,
    allow(
        clippy::too_many_lines,
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "Test assertions and scenarios"
    )
)]

pub mod adapter;
pub mod compaction_state;
mod error;
mod external_sessions;
pub mod history_dependency;
pub mod idle_compaction;
pub mod plan_mode_actions;
pub mod pr_detection;
pub mod quota;
mod registry;
pub mod resolve_executable;
pub mod skills;
pub mod title;
pub mod version;

#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

pub use adapter::{
    Adapter, AdapterSession, CollectedHistoryFiles, ContextFiles, FORK_CUT_NOT_FOUND_REASON,
    ForkCut, ForkPinError, ForkPinRequest, HistoryFiles, ImageInput, LoadedSkill, SessionSink,
    StopBackgroundTaskResult,
};
pub use error::AdapterError;
pub use external_sessions::ExternalSessions;
pub use history_dependency::HistoryDependency;
/// Boxed future for async adapter trait methods.
pub use mainframe_types::BoxFuture;
pub use mainframe_types::adapter::{ControlRequest, ControlResponse};
pub use plan_mode_actions::{
    PlanActionContext, PlanChatUpdate, PlanModeActionHandler, clear_context_and_restart,
};
pub use quota::QuotaSource;
pub use registry::{AdapterRegistry, RefreshDeps};
pub use resolve_executable::{RunResult, Runner};
pub use skills::SkillsProvider;
pub use title::finalize_title;
