//! Ported from `src/quota/constants.ts` — the lifecycle duration/staleness knobs.
//! All values are epoch-milliseconds spans (`i64`), matching the shared type's
//! `resetsAt`/`observedAt` unit.

/// How long a session window stays trusted when the provider gives no `resetsAt`.
pub const SESSION_WINDOW_DURATION_MS: i64 = 5 * 60 * 60 * 1000;

/// How long a weekly/weekly-model window stays trusted when the provider gives no `resetsAt`.
pub const WEEKLY_WINDOW_DURATION_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// Age past which a provider blob is flagged stale, ahead of its expiry ceiling.
pub const STALE_THRESHOLD_MS: i64 = 12 * 60 * 1000;
