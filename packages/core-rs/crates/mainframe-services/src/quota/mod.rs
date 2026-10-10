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
mod window_lifecycle;

pub use constants::{SESSION_WINDOW_DURATION_MS, STALE_THRESHOLD_MS, WEEKLY_WINDOW_DURATION_MS};
pub use keying::UNKNOWN_ACCOUNT_IDENTITY;
pub use manager::{
    IdentityResolver, IngestMode, QuotaManager, QuotaManagerDeps, QuotaPuller, QuotaService,
    QuotaSettingsStore,
};
pub use merge::ProviderQuotaUpdate;
pub use scheduler::{ClaudeQuotaScheduler, ClaudeQuotaSchedulerDeps, HasClientsFn, RefreshFn};
