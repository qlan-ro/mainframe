//! Resolution shared by `chat_launch` and `delegate_task`: which adapter and
//! model a new chat gets, whether its privileges stay under the caller's,
//! where it runs, and whether the caller may create another chat at all.

use mainframe_types::chat::NO_PROJECT_ID;
use mainframe_types::settings::{EXECUTION_MODES, ExecutionMode};

use crate::errors::{ErrorCode, ToolError};
use crate::input::{WorkspaceInput, WorkspaceMode};
use crate::policy::{
    MAX_DEPTH, Privileges, check_ceiling, effective_mode_rank, mode_label_supported,
};
use crate::ports::{ChatView, LaunchWorkspace};
use crate::service::OrchestrationService;

/// The project id agents use for non-project chats.
const NO_PROJECT_ALIAS: &str = "no-project";

pub(super) async fn resolve_project(
    svc: &OrchestrationService,
    requested: Option<&str>,
    caller: &ChatView,
) -> Result<String, ToolError> {
    let project_id = match requested {
        Some(NO_PROJECT_ALIAS) => NO_PROJECT_ID.to_string(),
        Some(id) => id.to_string(),
        None => caller.project_id.clone(),
    };
    if project_id != NO_PROJECT_ID && !svc.port.project_exists(&project_id).await {
        return Err(ToolError::new(
            ErrorCode::ProjectNotFound,
            format!("No project {project_id}."),
        ));
    }
    Ok(project_id)
}

/// The adapter (default: the caller's), its model (default: the caller's
/// when the adapter is unchanged, else the adapter's own default), and
/// whether it has a distinct `auto` mode (`AdapterCapabilities::auto_mode`)
/// — `resolve_privileges` needs that to clamp an inherited mode onto a
/// label the target can actually select.
pub(super) async fn resolve_adapter(
    svc: &OrchestrationService,
    adapter_id: Option<&str>,
    model: Option<&str>,
    caller: &ChatView,
) -> Result<(String, Option<String>, bool), ToolError> {
    let adapter_id = adapter_id.unwrap_or(&caller.adapter_id).to_string();
    let adapters = svc.port.adapters().await;
    let adapter = adapters
        .iter()
        .find(|a| a.id == adapter_id)
        .ok_or_else(|| {
            ToolError::new(
                ErrorCode::AdapterUnavailable,
                format!("No adapter {adapter_id}."),
            )
        })?;
    if !adapter.installed || !adapter.available {
        let reason = adapter
            .unavailable_reason
            .clone()
            .unwrap_or_else(|| "not installed".into());
        return Err(ToolError::new(
            ErrorCode::AdapterUnavailable,
            format!("Adapter {adapter_id} is unavailable: {reason}"),
        ));
    }
    let model = match model {
        Some(m) => {
            if !adapter.models.is_empty() && !adapter.models.iter().any(|x| x.id == m) {
                return Err(ToolError::new(
                    ErrorCode::ModelUnavailable,
                    format!("Adapter {adapter_id} does not offer model {m}."),
                ));
            }
            Some(m.to_string())
        }
        None if adapter_id == caller.adapter_id => caller.model.clone(),
        None => None,
    };
    Ok((adapter_id, model, adapter.auto_mode))
}

/// The new chat's mode and plan flag: the caller's unless overridden, and
/// never above the caller's *effective* privilege on `target_adapter_id`
/// (the adapter the new chat will actually run on, which may differ from
/// the caller's own). `target_auto_mode` is that adapter's own
/// `AdapterCapabilities::auto_mode` (from the already-resolved
/// `ports::AdapterView`, via `resolve_adapter`).
///
/// An explicit `mode` is checked against the ceiling as asked: refusing it
/// is correct, because the agent asked for that exact privilege. A missing
/// `mode` is *inherited*, not asked for, so it is clamped instead of being
/// checked verbatim: the caller's own mode label can mean a different real
/// privilege on another provider (`policy::effective_mode_rank`), so
/// carrying the label across providers unchanged can "escalate" on paper
/// (and get refused) for a mode the agent never requested. See
/// `clamp_inherited_mode` for how the replacement is chosen.
pub(super) fn resolve_privileges(
    target_adapter_id: &str,
    target_auto_mode: bool,
    mode: Option<ExecutionMode>,
    plan: Option<bool>,
    caller: &ChatView,
) -> Result<Privileges, ToolError> {
    let resolved_mode = match mode {
        Some(explicit) => explicit,
        None => clamp_inherited_mode(target_adapter_id, target_auto_mode, caller),
    };
    let target = Privileges {
        adapter_id: target_adapter_id.to_string(),
        mode: resolved_mode,
        plan: plan.unwrap_or(caller.plan_mode),
    };
    check_ceiling(&caller.privileges(), &target)?;
    Ok(target)
}

/// The mode an inherited (unspecified) `permissionMode` resolves to on
/// `target_adapter_id`:
///
/// 1. If the caller's OWN label is itself valid on the target (every label
///    but `auto` always is; `auto` needs `target_auto_mode`) and still
///    within the caller's effective rank there, keep it unchanged. This is
///    the common case — same adapter, or a label that genuinely carries
///    over — and it is why a Claude `default` chat delegating to Codex with
///    no `permissionMode` gets Codex `default` back (both rank 0, since
///    Codex `default` now really does ask before every edit and command),
///    and a Codex `default` chat delegating to Codex keeps `default` too.
/// 2. Otherwise, among the target's labels that both: (a) the target
///    actually supports (`mode_label_supported`, so `auto` is never
///    offered when `target_auto_mode` is false even though its rank may
///    fit), and (b) fit under the caller's effective rank — pick the one
///    at the HIGHEST fitting rank, and the LOWEST label (`EXECUTION_MODES`'
///    own order) among ties at that rank. This is what a cross-adapter
///    inherit needs: a Claude `auto` parent (rank 2) delegating to Codex
///    gets Codex's `acceptEdits` (the highest-fitting rank there, since
///    Codex `default` is now a strictly lower real privilege, rank 0), not
///    `auto`, which Codex cannot select at all.
/// 3. If nothing on the target fits rule 2 either, returns the target's
///    own least-privileged SUPPORTED mode instead of guessing: its rank
///    still exceeds the caller's, so `check_ceiling` refuses clearly
///    rather than this function silently granting something unsafe.
fn clamp_inherited_mode(
    target_adapter_id: &str,
    target_auto_mode: bool,
    caller: &ChatView,
) -> ExecutionMode {
    let caller_rank = effective_mode_rank(&caller.adapter_id, caller.permission_mode);
    if mode_label_supported(caller.permission_mode, target_auto_mode)
        && effective_mode_rank(target_adapter_id, caller.permission_mode) <= caller_rank
    {
        return caller.permission_mode;
    }
    let supported = || {
        EXECUTION_MODES
            .into_iter()
            .filter(move |&m| mode_label_supported(m, target_auto_mode))
    };
    let mut best: Option<(u8, ExecutionMode)> = None;
    for mode in supported() {
        let rank = effective_mode_rank(target_adapter_id, mode);
        if rank > caller_rank {
            continue;
        }
        // `EXECUTION_MODES` is ascending by label; keep the first (lowest
        // label) seen at the best rank, so a later tie at the same rank
        // does not overwrite it.
        if best.is_none_or(|(best_rank, _)| rank > best_rank) {
            best = Some((rank, mode));
        }
    }
    best.map(|(_, mode)| mode).unwrap_or_else(|| {
        supported()
            .min_by_key(|&m| effective_mode_rank(target_adapter_id, m))
            .unwrap_or(ExecutionMode::Default)
    })
}

pub(super) fn resolve_workspace(
    input: Option<&WorkspaceInput>,
    default: WorkspaceMode,
    caller: &ChatView,
    project_id: &str,
) -> Result<LaunchWorkspace, ToolError> {
    let mode = input.map_or(default, |w| w.mode);
    let invalid = |msg: &str| ToolError::new(ErrorCode::WorkspaceInvalid, msg);
    Ok(match mode {
        WorkspaceMode::ProjectRoot => LaunchWorkspace::ProjectRoot,
        WorkspaceMode::Inherit if project_id != caller.project_id => {
            return Err(invalid(
                "inherit is only allowed within the caller's project",
            ));
        }
        WorkspaceMode::Inherit => LaunchWorkspace::Shared {
            worktree_path: caller.worktree_path.clone(),
            branch_name: caller.branch_name.clone(),
        },
        WorkspaceMode::NewWorktree => {
            let w = input.ok_or_else(|| invalid("new_worktree needs branchName and baseBranch"))?;
            let (Some(branch_name), Some(base_branch)) = (&w.branch_name, &w.base_branch) else {
                return Err(invalid("new_worktree needs branchName and baseBranch"));
            };
            LaunchWorkspace::NewWorktree {
                base_branch: base_branch.clone(),
                branch_name: branch_name.clone(),
            }
        }
        WorkspaceMode::ExistingWorktree => {
            let path = input
                .and_then(|w| w.worktree_path.clone())
                .ok_or_else(|| invalid("existing_worktree needs worktreePath"))?;
            LaunchWorkspace::ExistingWorktree {
                worktree_path: path,
            }
        }
    })
}

/// Depth and rate limits for a caller about to create a chat. Depth is
/// checked first so a refused call does not use up the rate window.
pub(super) async fn admit_creation(
    svc: &OrchestrationService,
    caller: &ChatView,
) -> Result<u32, ToolError> {
    let depth = svc.depth_of(caller).await + 1;
    if depth > MAX_DEPTH {
        return Err(ToolError::new(
            ErrorCode::DepthLimitExceeded,
            format!("Chats may be started at most {MAX_DEPTH} levels deep."),
        ));
    }
    svc.limiter.try_acquire(&caller.id)?;
    Ok(depth)
}

#[cfg(test)]
mod tests {
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
}
