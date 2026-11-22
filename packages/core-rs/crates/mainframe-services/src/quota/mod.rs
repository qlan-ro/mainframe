//! Shared quota lifecycle. Pure derivation lives in the leaf modules; `manager` holds the
//! daemon's in-memory state and `scheduler` drives Claude's pull cadence.

mod backoff;
mod constants;
mod identity;
mod keying;
mod manager;
mod merge;
mod persist;
mod scheduler;
mod status;
mod window_lifecycle;

pub use identity::IdentityResolver;
pub use manager::{IngestMode, QuotaManager, QuotaManagerDeps, QuotaPuller, QuotaService};
pub use scheduler::{ClaudeQuotaScheduler, ClaudeQuotaSchedulerDeps, HasClientsFn, RefreshFn};
