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
/// The longest any single blocking tool call (`chat_wait`, `task_status`
/// `waitMs`, `delegate_task` `mode: "wait"`) actually holds its HTTP request
/// open for, regardless of the caller's requested timeout. Both adapters are
/// configured to raise their own per-tool-call timeout to 3 900 000 ms (see
/// `orchestration_args.rs` in each adapter crate), but that relies on the
/// raised value actually taking effect end to end — unverified live (spec
/// Gate 0), and silently lost if a user's own MCP server is also named
/// `mainframe` and wins the name collision. Both clients' *un-configured*
/// default is 60 s (Claude's own fallback, and Codex's `tool_timeout_sec`
/// default), so this cap stays safely under that floor instead of trusting
/// the raised value. A call that hits this cap before the caller's own
/// requested timeout elapses returns a non-final, resumable result instead
/// of the HTTP request staying open: `chat_wait` reports `stillWaiting:
/// true` with `waitTimedOut: false`; the task tools' existing
/// `waitReturned: "timeout"` already has that meaning (the task is not
/// cancelled and can be waited on again).
pub const MAX_SINGLE_WAIT_MS: u64 = 45_000;
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

/// `default 0 < acceptEdits 1 < auto 2 < yolo 3`. This is the mode's label
/// rank, not its real-world privilege: use [`effective_mode_rank`] for the
/// ceiling, which is adapter-aware.
#[must_use]
pub fn mode_rank(mode: ExecutionMode) -> u8 {
    match mode {
        ExecutionMode::Default => 0,
        ExecutionMode::AcceptEdits => 1,
        ExecutionMode::Auto => 2,
        ExecutionMode::Yolo => 3,
    }
}

/// The mode's real privilege on `adapter_id`, for the ceiling. Mode *labels*
/// do not carry the same privilege on every provider. Codex `default` now
/// really does ask before every edit and every command (approval
/// `untrusted` plus sandbox `read-only`
/// (`mainframe-adapter-codex::session_thread::permission_mode_policy`)) — the
/// same real privilege as Claude's `default`, rank 0. Codex `acceptEdits`
/// and `auto` both map to approval `on-request` plus sandbox
/// `workspace-write`: they edit the workspace unprompted, the same real
/// privilege as Claude's `acceptEdits`, rank 1. Only Codex `yolo` (`never`
/// approval, `danger-full-access`) is more privileged, rank 3.
#[must_use]
pub fn effective_mode_rank(adapter_id: &str, mode: ExecutionMode) -> u8 {
    if adapter_id == "codex" {
        match mode {
            ExecutionMode::Default => 0,
            ExecutionMode::AcceptEdits | ExecutionMode::Auto => 1,
            ExecutionMode::Yolo => 3,
        }
    } else {
        mode_rank(mode)
    }
}

/// Whether `mode`'s label is one `adapter_auto_mode` (the adapter's
/// `AdapterCapabilities::auto_mode`, carried on `ports::AdapterView`) would
/// actually let the chat select: every label but `auto` always is: `auto`
/// needs the adapter's own distinct auto mode, which Codex does not have
/// (`auto_mode: false`) even though its `effective_mode_rank` for `auto`
/// happens to equal `default`/`acceptEdits`'s — a rank match is not the
/// same as the label being valid on that adapter.
#[must_use]
pub fn mode_label_supported(mode: ExecutionMode, adapter_auto_mode: bool) -> bool {
    mode != ExecutionMode::Auto || adapter_auto_mode
}

/// A caller's privileges: its adapter, permission mode, and whether it is in
/// plan mode. The adapter travels with the mode because the mode alone does
/// not say how privileged it really is (see [`effective_mode_rank`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Privileges {
    pub adapter_id: String,
    pub mode: ExecutionMode,
    pub plan: bool,
}

/// A target (a new chat, or a chat the caller drives) may never hold more
/// privilege than the caller: no higher *effective* mode, and a plan-mode
/// caller may only reach plan-mode chats. The comparison is cross-provider:
/// a Claude caller's rank and a Codex target's rank are both read through
/// [`effective_mode_rank`] before comparing, so the same label on different
/// providers does not compare as equal unless it really is.
pub fn check_ceiling(caller: &Privileges, target: &Privileges) -> Result<(), ToolError> {
    let caller_rank = effective_mode_rank(&caller.adapter_id, caller.mode);
    let target_rank = effective_mode_rank(&target.adapter_id, target.mode);
    if target_rank > caller_rank {
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

    fn priv_for(adapter_id: &str, mode: ExecutionMode, plan: bool) -> Privileges {
        Privileges {
            adapter_id: adapter_id.to_string(),
            mode,
            plan,
        }
    }

    #[test]
    fn ceiling_matrix_covers_every_mode_and_plan_pair_on_one_adapter() {
        for caller_mode in MODES {
            for target_mode in MODES {
                for (caller_plan, target_plan) in
                    [(false, false), (false, true), (true, false), (true, true)]
                {
                    let result = check_ceiling(
                        &priv_for("claude", caller_mode, caller_plan),
                        &priv_for("claude", target_mode, target_plan),
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

    #[test]
    fn codex_accept_edits_and_auto_rank_equal_and_above_default_and_below_yolo() {
        // `acceptEdits` and `auto` both let Codex edit the workspace without
        // a prompt (`permission_mode_policy`): they may delegate to each
        // other and to `default` (which now really does ask first, a lower
        // real privilege), but not to `yolo`.
        for a in [ExecutionMode::AcceptEdits, ExecutionMode::Auto] {
            for b in [
                ExecutionMode::Default,
                ExecutionMode::AcceptEdits,
                ExecutionMode::Auto,
            ] {
                assert!(
                    check_ceiling(&priv_for("codex", a, false), &priv_for("codex", b, false))
                        .is_ok()
                );
            }
            assert!(
                check_ceiling(
                    &priv_for("codex", a, false),
                    &priv_for("codex", ExecutionMode::Yolo, false)
                )
                .is_err()
            );
        }
    }

    #[test]
    fn a_cautious_claude_default_parent_may_delegate_to_a_cautious_codex_default_child() {
        // Codex `default` now really does ask before every edit and every
        // command (approval `untrusted`, sandbox `read-only`) — the same
        // real privilege as Claude's `default`, rank 0. A Claude `default`
        // parent may reach it, but not Codex `acceptEdits`/`auto`, which
        // still edit the workspace unprompted (rank 1).
        assert!(
            check_ceiling(
                &priv_for("claude", ExecutionMode::Default, false),
                &priv_for("codex", ExecutionMode::Default, false),
            )
            .is_ok()
        );
        for codex_mode in [ExecutionMode::AcceptEdits, ExecutionMode::Auto] {
            let err = check_ceiling(
                &priv_for("claude", ExecutionMode::Default, false),
                &priv_for("codex", codex_mode, false),
            )
            .unwrap_err();
            assert_eq!(err.code, ErrorCode::PermissionModeEscalationDenied);
        }
    }

    #[test]
    fn a_claude_accept_edits_parent_may_delegate_to_an_unprompted_codex_child() {
        // Claude `acceptEdits` (rank 1) already edits unprompted itself, at
        // least the same real privilege as Codex `default` (rank 0, asks
        // first) and exactly the same as Codex `acceptEdits`/`auto` (rank 1).
        for codex_mode in [
            ExecutionMode::Default,
            ExecutionMode::AcceptEdits,
            ExecutionMode::Auto,
        ] {
            assert!(
                check_ceiling(
                    &priv_for("claude", ExecutionMode::AcceptEdits, false),
                    &priv_for("codex", codex_mode, false),
                )
                .is_ok()
            );
        }
        // Yolo is still a strictly higher rank than Claude acceptEdits.
        let err = check_ceiling(
            &priv_for("claude", ExecutionMode::AcceptEdits, false),
            &priv_for("codex", ExecutionMode::Yolo, false),
        )
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::PermissionModeEscalationDenied);
    }

    #[test]
    fn a_codex_default_parent_cannot_delegate_to_a_claude_accept_edits_child() {
        // Reverse direction: Codex `default` is now effective rank 0 (it
        // really does ask first), strictly below Claude `acceptEdits`
        // (rank 1), so it may reach neither `acceptEdits` nor `auto`.
        for claude_mode in [ExecutionMode::AcceptEdits, ExecutionMode::Auto] {
            let err = check_ceiling(
                &priv_for("codex", ExecutionMode::Default, false),
                &priv_for("claude", claude_mode, false),
            )
            .unwrap_err();
            assert_eq!(err.code, ErrorCode::PermissionModeEscalationDenied);
        }
        // Codex `default` may still reach Claude `default` (both rank 0).
        assert!(
            check_ceiling(
                &priv_for("codex", ExecutionMode::Default, false),
                &priv_for("claude", ExecutionMode::Default, false),
            )
            .is_ok()
        );
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
