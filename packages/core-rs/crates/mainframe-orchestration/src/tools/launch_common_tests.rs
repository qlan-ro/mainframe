use super::*;
use crate::errors::ErrorCode;
use crate::test_support::chat_view;

/// `false` for Codex, `true` for Claude — matches
/// `AdapterCapabilities::auto_mode` in each adapter crate.
fn auto_mode(adapter_id: &str) -> bool {
    adapter_id != "codex"
}

fn resolve(
    target_adapter_id: &str,
    mode: Option<ExecutionMode>,
    caller: &ChatView,
) -> Result<Privileges, ToolError> {
    resolve_privileges(
        target_adapter_id,
        auto_mode(target_adapter_id),
        mode,
        None,
        caller,
    )
}

#[test]
fn codex_default_delegating_to_codex_keeps_default() {
    // The bug this regresses: a top-down rank sweep over
    // [Default, AcceptEdits, Auto, Yolo] picked `auto` for ANY caller
    // rank 1–2, because Codex ranks all three the same. `auto` is not
    // a mode Codex supports at all (`auto_mode: false`; the UI cannot
    // select it, and switch_plan.rs converts it to `default` on a
    // switch there) — rule 1 (keep the caller's own valid label)
    // avoids ever needing to choose among the tied labels here.
    let mut caller = chat_view("codex-caller");
    caller.adapter_id = "codex".into();
    caller.permission_mode = ExecutionMode::Default;
    let target = resolve("codex", None, &caller).unwrap();
    assert_eq!(target.mode, ExecutionMode::Default);
}

#[test]
fn claude_accept_edits_delegating_to_codex_keeps_accept_edits() {
    // The label itself carries over: Claude's `acceptEdits` (rank 1)
    // is both valid on Codex and within the caller's rank there.
    let mut caller = chat_view("claude-caller");
    caller.adapter_id = "claude".into();
    caller.permission_mode = ExecutionMode::AcceptEdits;
    let target = resolve("codex", None, &caller).unwrap();
    assert_eq!(target.mode, ExecutionMode::AcceptEdits);
}

#[test]
fn claude_auto_delegating_to_codex_gets_accept_edits_not_auto() {
    // Claude `auto` (rank 2) is not itself valid on Codex
    // (`auto_mode: false`), so rule 2 picks among Codex's SUPPORTED
    // labels at or under rank 2, at the HIGHEST fitting rank:
    // `acceptEdits` (rank 1), not `default` (rank 0, which now really
    // does ask first) and never `auto` regardless of rank.
    let mut caller = chat_view("claude-caller");
    caller.adapter_id = "claude".into();
    caller.permission_mode = ExecutionMode::Auto;
    let target = resolve("codex", None, &caller).unwrap();
    assert_eq!(target.mode, ExecutionMode::AcceptEdits);
}

#[test]
fn codex_auto_delegating_to_claude_gets_accept_edits() {
    let mut caller = chat_view("codex-caller");
    caller.adapter_id = "codex".into();
    caller.permission_mode = ExecutionMode::Auto; // effective rank 1 on codex
    let target = resolve("claude", None, &caller).unwrap();
    // Claude's own rank-1 mode, not the inherited "auto" label, which
    // would be Claude's rank-2 mode and get refused as an escalation.
    assert_eq!(target.mode, ExecutionMode::AcceptEdits);
}

#[test]
fn an_explicitly_requested_mode_is_still_checked_against_the_ceiling() {
    let mut caller = chat_view("codex-caller");
    caller.adapter_id = "codex".into();
    caller.permission_mode = ExecutionMode::Auto;
    let err = resolve("claude", Some(ExecutionMode::Auto), &caller).unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionModeEscalationDenied);
}

#[test]
fn clamp_inherited_mode_never_offers_auto_on_an_adapter_without_it() {
    for caller_adapter in ["claude", "codex"] {
        for caller_mode in EXECUTION_MODES {
            let mut caller = chat_view("caller");
            caller.adapter_id = caller_adapter.into();
            caller.permission_mode = caller_mode;
            let mode = clamp_inherited_mode("codex", false, &caller);
            assert_ne!(
                mode,
                ExecutionMode::Auto,
                "{caller_adapter} {caller_mode:?} -> codex"
            );
        }
    }
}

#[test]
fn a_claude_default_parent_can_delegate_to_codex_and_the_child_gets_codex_default() {
    // Codex `default` (approval `on-request`, sandbox `read-only`) asks
    // before anything that writes or needs the network; reads run free
    // in the sandbox — the same real privilege as Claude's `default`
    // (rank 0 on both). Rule 1
    // (keep the caller's own valid label) applies: a Claude `default`
    // caller with no explicit `permissionMode` must be able to
    // delegate to Codex, and the child must get Codex `default`, not be
    // refused.
    let caller = chat_view("claude-caller");
    let target = resolve("codex", None, &caller).unwrap();
    assert_eq!(target.mode, ExecutionMode::Default);
}

#[test]
fn a_codex_default_parent_cannot_create_a_claude_accept_edits_child() {
    // Reverse direction: a Codex `default` caller (rank 0) explicitly
    // asking for a Claude `acceptEdits` child (rank 1) must be refused
    // as an escalation, even though both labels say "default"-adjacent
    // things on paper.
    let mut caller = chat_view("codex-caller");
    caller.adapter_id = "codex".into();
    caller.permission_mode = ExecutionMode::Default;
    let err = resolve("claude", Some(ExecutionMode::AcceptEdits), &caller).unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionModeEscalationDenied);
}
