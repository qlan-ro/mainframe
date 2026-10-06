//! Resolution shared by `chat_launch` and `delegate_task`: which adapter and
//! model a new chat gets, whether its privileges stay under the caller's,
//! where it runs, and whether the caller may create another chat at all.

use mainframe_types::chat::NO_PROJECT_ID;
use mainframe_types::settings::ExecutionMode;

use crate::errors::{ErrorCode, ToolError};
use crate::input::{WorkspaceInput, WorkspaceMode};
use crate::policy::{MAX_DEPTH, Privileges, check_ceiling};
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
/// never above the caller's.
pub(super) fn resolve_privileges(
    mode: Option<ExecutionMode>,
    plan: Option<bool>,
    caller: &ChatView,
) -> Result<Privileges, ToolError> {
    let target = Privileges {
        mode: mode.unwrap_or(caller.permission_mode),
        plan: plan.unwrap_or(caller.plan_mode),
    };
    check_ceiling(caller.privileges(), target)?;
    Ok(target)
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
