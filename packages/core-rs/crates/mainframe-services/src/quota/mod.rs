//! Shared quota-lifecycle engine, ported 1:1 from `src/quota/` (TypeScript is
//! canonical). Pure derivation lives in the leaf modules; `manager` holds the
//! daemon's in-memory state and `scheduler` drives Claude's pull cadence.

mod backoff;
mod constants;
mod keying;
mod manager;
mod merge;
mod scheduler;
mod status;
mod tightest_window;
mod window_lifecycle;

pub use backoff::{handle_pull_failure, unknown_provider_quota};
pub use constants::{SESSION_WINDOW_DURATION_MS, STALE_THRESHOLD_MS, WEEKLY_WINDOW_DURATION_MS};
pub use keying::{UNKNOWN_ACCOUNT_IDENTITY, compute_quota_key, resolve_account_identity};
pub use manager::{
    IdentityResolver, IngestMode, QuotaManager, QuotaManagerDeps, QuotaPuller, QuotaService,
    QuotaSettingsStore,
};
pub use merge::{ProviderQuotaUpdate, merge_provider_quota};
pub use scheduler::{ClaudeQuotaScheduler, ClaudeQuotaSchedulerDeps, HasClientsFn, RefreshFn};
pub use status::derive_provider_status;
pub use tightest_window::select_tightest_window;
pub use window_lifecycle::{
    collect_quota_windows, effective_reset_at, is_provider_stale, is_window_trusted,
};
