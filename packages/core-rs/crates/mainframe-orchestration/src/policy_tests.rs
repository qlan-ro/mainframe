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
                check_ceiling(&priv_for("codex", a, false), &priv_for("codex", b, false)).is_ok()
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
    // Codex `default` (approval `on-request`, sandbox `read-only`) asks
    // before anything that writes or needs the network; reads run free
    // in the sandbox — the same real privilege as Claude's `default`,
    // rank 0. A Claude `default`
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

#[test]
fn mode_meaning_covers_every_mode_on_both_adapters_with_a_nonempty_line() {
    for adapter_id in ["claude", "codex"] {
        for mode in MODES {
            assert!(!mode_meaning(adapter_id, mode).is_empty());
        }
    }
}

#[test]
fn codex_default_meaning_says_it_asks_before_writes_and_network_but_not_reads() {
    let meaning = mode_meaning("codex", ExecutionMode::Default);
    assert!(meaning.contains("writes"));
    assert!(meaning.contains("network"));
    assert!(meaning.contains("read"));
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
