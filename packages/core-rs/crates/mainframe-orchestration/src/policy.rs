//! Limits and the privilege ceiling. The numbers are first guesses (spec "Open
//! questions") kept in one place so tuning them is a one-line change.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use mainframe_types::settings::ExecutionMode;

use crate::errors::{ErrorCode, ToolError};

/// Longest `created_by_chat_id` chain a chat may start new chats from.
pub const MAX_DEPTH: u32 = 3;
pub const MAX_ACTIVE_TASKS_PER_TREE: usize = 8;
pub const MAX_ACTIVE_TASKS_PER_PARENT: usize = 4;
pub const CREATION_LIMIT: usize = 20;
pub const CREATION_WINDOW: Duration = Duration::from_secs(600);
pub const MAX_CONCURRENT_WAITS: usize = 4;
pub const DEFAULT_WAIT_MS: u64 = 600_000;
pub const MAX_WAIT_MS: u64 = 3_600_000;
pub const MIN_WAIT_MS: u64 = 1_000;
pub const READ_MAX_ITEMS: usize = 100;
pub const READ_MAX_CHARS: usize = 8_000;
pub const READ_MIN_CHARS: usize = 200;
pub const READ_DEFAULT_ITEMS: usize = 20;
pub const READ_DEFAULT_CHARS: usize = 2_000;
/// Bigger results are moved to a file by Claude, which the model then has to
/// read back; staying under keeps a result inline.
pub const RESULT_BUDGET_BYTES: usize = 20_000;
pub const SUMMARY_CAP: usize = 16_000;
pub const LAST_TEXT_CAP: usize = 4_000;
pub const ERROR_MESSAGE_CAP: usize = 1_000;
pub const TEXT_MAX: usize = 100_000;
pub const TITLE_MAX: usize = 200;
pub const REASON_MAX: usize = 500;

/// `default 0 < acceptEdits 1 < auto 2 < yolo 3`.
#[must_use]
pub fn mode_rank(mode: ExecutionMode) -> u8 {
    match mode {
        ExecutionMode::Default => 0,
        ExecutionMode::AcceptEdits => 1,
        ExecutionMode::Auto => 2,
        ExecutionMode::Yolo => 3,
    }
}

/// A caller's privileges: the permission mode and whether it is in plan mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Privileges {
    pub mode: ExecutionMode,
    pub plan: bool,
}

/// A target (a new chat, or a chat the caller drives) may never hold more
/// privilege than the caller: no higher mode, and a plan-mode caller may only
/// reach plan-mode chats.
pub fn check_ceiling(caller: Privileges, target: Privileges) -> Result<(), ToolError> {
    if mode_rank(target.mode) > mode_rank(caller.mode) {
        return Err(ToolError::new(
            ErrorCode::PermissionModeEscalationDenied,
            "The target's permission mode is higher than the caller's.",
        ));
    }
    if caller.plan && !target.plan {
        return Err(ToolError::new(
            ErrorCode::PlanModeEscalationDenied,
            "A plan-mode caller may only create or drive plan-mode chats.",
        ));
    }
    Ok(())
}

/// Time source, injectable so the sliding window is testable without sleeping.
pub trait Clock: Send + Sync {
    fn now(&self) -> Instant;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// Chat creations per caller chat in a sliding window.
pub struct CreationLimiter {
    clock: Box<dyn Clock>,
    events: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl CreationLimiter {
    #[must_use]
    pub fn new(clock: Box<dyn Clock>) -> Self {
        Self {
            clock,
            events: Mutex::new(HashMap::new()),
        }
    }

    /// Creations `chat_id` may still make in the current window.
    pub fn remaining(&self, chat_id: &str) -> usize {
        let now = self.clock.now();
        let mut events = self.events.lock().unwrap_or_else(|e| e.into_inner());
        let used = prune(events.entry(chat_id.to_string()).or_default(), now);
        CREATION_LIMIT.saturating_sub(used)
    }

    /// Records one creation, or refuses it when the window is full.
    pub fn try_acquire(&self, chat_id: &str) -> Result<(), ToolError> {
        let now = self.clock.now();
        let mut events = self.events.lock().unwrap_or_else(|e| e.into_inner());
        let window = events.entry(chat_id.to_string()).or_default();
        if prune(window, now) >= CREATION_LIMIT {
            return Err(ToolError::new(
                ErrorCode::RateLimited,
                format!(
                    "At most {CREATION_LIMIT} chats may be created per caller in {} minutes.",
                    CREATION_WINDOW.as_secs() / 60
                ),
            ));
        }
        window.push_back(now);
        Ok(())
    }
}

fn prune(window: &mut VecDeque<Instant>, now: Instant) -> usize {
    while window
        .front()
        .is_some_and(|t| now.saturating_duration_since(*t) >= CREATION_WINDOW)
    {
        window.pop_front();
    }
    window.len()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    const MODES: [ExecutionMode; 4] = [
        ExecutionMode::Default,
        ExecutionMode::AcceptEdits,
        ExecutionMode::Auto,
        ExecutionMode::Yolo,
    ];

    #[test]
    fn ceiling_matrix_covers_every_mode_and_plan_pair() {
        for caller_mode in MODES {
            for target_mode in MODES {
                for (caller_plan, target_plan) in
                    [(false, false), (false, true), (true, false), (true, true)]
                {
                    let result = check_ceiling(
                        Privileges {
                            mode: caller_mode,
                            plan: caller_plan,
                        },
                        Privileges {
                            mode: target_mode,
                            plan: target_plan,
                        },
                    );
                    let mode_ok = mode_rank(target_mode) <= mode_rank(caller_mode);
                    let plan_ok = !caller_plan || target_plan;
                    assert_eq!(result.is_ok(), mode_ok && plan_ok);
                    if !mode_ok {
                        let code = result.err().map(|e| e.code);
                        assert_eq!(code, Some(ErrorCode::PermissionModeEscalationDenied));
                    }
                }
            }
        }
    }

    struct FakeClock {
        base: Instant,
        offset_secs: Arc<AtomicU64>,
    }

    impl Clock for FakeClock {
        fn now(&self) -> Instant {
            self.base + Duration::from_secs(self.offset_secs.load(Ordering::SeqCst))
        }
    }

    #[test]
    fn sliding_window_refuses_the_21st_creation_then_recovers() {
        let offset = Arc::new(AtomicU64::new(0));
        let limiter = CreationLimiter::new(Box::new(FakeClock {
            base: Instant::now(),
            offset_secs: offset.clone(),
        }));
        for _ in 0..CREATION_LIMIT {
            assert!(limiter.try_acquire("p").is_ok());
        }
        let err = limiter.try_acquire("p").err().map(|e| e.code);
        assert_eq!(err, Some(ErrorCode::RateLimited));
        assert_eq!(limiter.remaining("other"), CREATION_LIMIT);
        offset.store(CREATION_WINDOW.as_secs(), Ordering::SeqCst);
        assert_eq!(limiter.remaining("p"), CREATION_LIMIT);
        assert!(limiter.try_acquire("p").is_ok());
    }
}
