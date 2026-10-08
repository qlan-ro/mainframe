//! Resolution shared by `chat_launch` and `delegate_task`: which adapter and
//! model a new chat gets, whether its privileges stay under the caller's,
//! where it runs, and whether the caller may create another chat at all.

use mainframe_types::chat::NO_PROJECT_ID;
use mainframe_types::settings::{EXECUTION_MODES, ExecutionMode};

use crate::errors::{ErrorCode, ToolError};
use crate::input::{WorkspaceInput, WorkspaceMode};
use crate::policy::{MAX_DEPTH, Privileges, check_ceiling, effective_mode_rank};
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

/// The adapter (default: the caller's) and model (default: the caller's when
/// the adapter is unchanged, else the adapter's own default).
pub(super) async fn resolve_adapter(
    svc: &OrchestrationService,
    adapter_id: Option<&str>,
    model: Option<&str>,
    caller: &ChatView,
) -> Result<(String, Option<String>), ToolError> {
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
    Ok((adapter_id, model))
}

/// The new chat's mode and plan flag: the caller's unless overridden, and
/// never above the caller's *effective* privilege on `target_adapter_id`
/// (the adapter the new chat will actually run on, which may differ from
/// the caller's own).
///
/// An explicit `mode` is checked against the ceiling as asked: refusing it
/// is correct, because the agent asked for that exact privilege. A missing
/// `mode` is *inherited*, not asked for, so it is clamped to the highest
/// mode `target_adapter_id` allows within the caller's effective rank
/// instead of being checked verbatim: the caller's own mode label can mean
/// a different real privilege on another provider
/// (`policy::effective_mode_rank`), so carrying the label across providers
/// unchanged can "escalate" on paper (and get refused) for a mode the
/// agent never requested. A Codex `auto` parent (effective rank 1)
/// delegating to Claude with no `permissionMode` gets Claude's
/// `acceptEdits` (also rank 1), not a refusal for Claude's `auto`
/// (rank 2), which is a real escalation the label alone does not show.
pub(super) fn resolve_privileges(
    target_adapter_id: &str,
    mode: Option<ExecutionMode>,
    plan: Option<bool>,
    caller: &ChatView,
) -> Result<Privileges, ToolError> {
    let resolved_mode = match mode {
        Some(explicit) => explicit,
        None => {
            let caller_rank = effective_mode_rank(&caller.adapter_id, caller.permission_mode);
            clamp_inherited_mode(target_adapter_id, caller_rank)
        }
    };
    let target = Privileges {
        adapter_id: target_adapter_id.to_string(),
        mode: resolved_mode,
        plan: plan.unwrap_or(caller.plan_mode),
    };
    check_ceiling(&caller.privileges(), &target)?;
    Ok(target)
}

/// The highest-ranked mode on `target_adapter_id` whose effective privilege
/// does not exceed `caller_rank`. When no mode on the target fits at all
/// (a Claude `default` caller, rank 0, inheriting into Codex, whose floor
/// is rank 1 — Codex has no "ask before every edit" mode to offer), returns
/// the target's own least-privileged mode instead of guessing: its rank
/// still exceeds `caller_rank`, so `check_ceiling` refuses clearly rather
/// than this function silently granting something unsafe.
fn clamp_inherited_mode(target_adapter_id: &str, caller_rank: u8) -> ExecutionMode {
    EXECUTION_MODES
        .into_iter()
        .rev()
        .find(|&m| effective_mode_rank(target_adapter_id, m) <= caller_rank)
        .unwrap_or_else(|| lowest_rank_mode(target_adapter_id))
}

fn lowest_rank_mode(target_adapter_id: &str) -> ExecutionMode {
    EXECUTION_MODES
        .into_iter()
        .min_by_key(|&m| effective_mode_rank(target_adapter_id, m))
        .unwrap_or(ExecutionMode::Default)
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

    #[test]
    fn an_inherited_mode_is_clamped_to_the_targets_real_equivalent_not_refused() {
        let mut caller = chat_view("codex-caller");
        caller.adapter_id = "codex".into();
        caller.permission_mode = ExecutionMode::Auto; // effective rank 1 on codex
        let target = resolve_privileges("claude", None, None, &caller).unwrap();
        // Claude's own rank-1 mode, not the inherited "auto" label, which
        // would be Claude's rank-2 mode and get refused as an escalation.
        assert_eq!(target.mode, ExecutionMode::AcceptEdits);
    }

    #[test]
    fn an_explicitly_requested_mode_is_still_checked_against_the_ceiling() {
        let mut caller = chat_view("codex-caller");
        caller.adapter_id = "codex".into();
        caller.permission_mode = ExecutionMode::Auto;
        let err =
            resolve_privileges("claude", Some(ExecutionMode::Auto), None, &caller).unwrap_err();
        assert_eq!(err.code, ErrorCode::PermissionModeEscalationDenied);
    }

    #[test]
    fn clamp_inherited_mode_stays_under_the_cap_whenever_the_target_can() {
        for rank in 0..=3u8 {
            for adapter in ["claude", "codex"] {
                let achievable = EXECUTION_MODES
                    .into_iter()
                    .any(|m| effective_mode_rank(adapter, m) <= rank);
                let mode = clamp_inherited_mode(adapter, rank);
                if achievable {
                    assert!(
                        effective_mode_rank(adapter, mode) <= rank,
                        "{adapter} rank {rank}"
                    );
                } else {
                    // No mode fits (e.g. Codex has no rank-0 mode): the
                    // lowest-privilege one on the target, left for
                    // check_ceiling to refuse.
                    let lowest = EXECUTION_MODES
                        .into_iter()
                        .map(|m| effective_mode_rank(adapter, m))
                        .min()
                        .unwrap();
                    assert_eq!(
                        effective_mode_rank(adapter, mode),
                        lowest,
                        "{adapter} rank {rank}"
                    );
                }
            }
        }
    }

    #[test]
    fn an_inherited_mode_is_refused_when_the_target_has_no_equivalent_at_all() {
        // Claude `default` is rank 0; Codex's floor is rank 1 (no "ask
        // before every edit" mode). Nothing on Codex is safe to inherit
        // into, so the call must be refused, not silently granted.
        let caller = chat_view("claude-caller");
        let err = resolve_privileges("codex", None, None, &caller).unwrap_err();
        assert_eq!(err.code, ErrorCode::PermissionModeEscalationDenied);
    }
}
