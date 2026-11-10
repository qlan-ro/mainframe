pub use mainframe_types::compaction::*;

pub const CLAUDE_CACHE_TTL_MS: u64 = 60 * 60 * 1000;
pub const CODEX_CACHE_TTL_MS: u64 = 30 * 60 * 1000;
pub const IDLE_COMPACTION_SWEEP_MS: u64 = 60_000;
pub const CLAUDE_COMPACTION_TIMEOUT_MS: u64 = 5_000;
pub const CODEX_COMPACTION_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompactionTiming {
    pub due_ms: u64,
    pub ttl_ms: u64,
    pub sweep_ms: u64,
}

impl CompactionTiming {
    pub fn for_ttl(ttl_ms: u64) -> Self {
        Self {
            due_ms: ttl_ms / 10 * 9 + (ttl_ms % 10 * 9).div_ceil(10),
            ttl_ms,
            sweep_ms: IDLE_COMPACTION_SWEEP_MS,
        }
    }
    pub fn from_override(value: &str) -> Result<Self, &'static str> {
        let invalid = "MAINFRAME_IDLE_COMPACTION_DELAY_MS must be a positive integral duration";
        if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
            return Err(invalid);
        }
        let due_ms = value.parse::<u64>().map_err(|_| invalid)?;
        if due_ms == 0 {
            return Err(invalid);
        }
        let ttl_ms = due_ms
            .checked_mul(10)
            .map(|n| n / 9)
            .filter(|n| *n <= i64::MAX as u64)
            .ok_or(invalid)?;
        let sweep_ms = ttl_ms.div_ceil(20).min(IDLE_COMPACTION_SWEEP_MS);
        Ok(Self {
            due_ms,
            ttl_ms,
            sweep_ms,
        })
    }
    pub fn is_due(self, now_ms: i64, completed_ms: Option<i64>) -> bool {
        completed_ms
            .and_then(|t| now_ms.checked_sub(t))
            .and_then(|n| u64::try_from(n).ok())
            .is_some_and(|elapsed| elapsed >= self.due_ms && elapsed <= self.ttl_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inclusive_windows_and_rollback() {
        for (ttl, cases) in [
            (CLAUDE_CACHE_TTL_MS, [53, 54, 60, 61]),
            (CODEX_CACHE_TTL_MS, [26, 27, 30, 31]),
        ] {
            let timing = CompactionTiming::for_ttl(ttl);
            for (minute, due) in cases.into_iter().zip([false, true, true, false]) {
                assert_eq!(timing.is_due(minute * 60_000, Some(0)), due);
            }
            assert!(!timing.is_due(ttl as i64 + 1, Some(0)));
            assert!(!timing.is_due(-1, Some(0)));
            assert!(!timing.is_due(0, None));
        }
    }
    #[test]
    fn override_is_checked_and_sweep_fits_window() {
        let t = CompactionTiming::from_override("60000").unwrap();
        assert_eq!(
            t,
            CompactionTiming {
                due_ms: 60000,
                ttl_ms: 66666,
                sweep_ms: 3334
            }
        );
        for value in ["", "0", "-1", "+1", "1.5", " 1", "18446744073709551615"] {
            assert!(CompactionTiming::from_override(value).is_err(), "{value}");
        }
    }
}
