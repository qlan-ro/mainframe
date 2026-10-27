use std::collections::HashMap;
use std::path::Path;

use mainframe_git::git_exec::{GitExecError, GitTimeout, exec_git};
use mainframe_git::git_parse::{WorktreeEntry, parse_worktree_list};
use mainframe_types::chat::Project;

#[derive(Debug, thiserror::Error)]
pub enum WorktreeError {
    #[error("{0}")]
    Git(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

async fn run_worktree_git(
    args: &[&str],
    cwd: &str,
    timeout: GitTimeout,
) -> Result<String, WorktreeError> {
    exec_git(args, cwd, timeout)
        .await
        .map_err(|error| match error {
            GitExecError::TimedOut { .. } => {
                WorktreeError::Git("git command timed out".to_string())
            }
            GitExecError::Failed { stderr, .. } => WorktreeError::Git(stderr),
            GitExecError::Spawn(message) => WorktreeError::Io(std::io::Error::other(message)),
            error @ GitExecError::DirectoryNotAccessible { .. } => {
                WorktreeError::Git(error.to_string())
            }
        })
}

/// True when `worktreePath` is a usable git worktree: the directory exists AND
/// carries a `.git` entry. Guards against orphaned stub dirs.
pub fn is_worktree_present(worktree_path: &str) -> bool {
    Path::new(worktree_path).exists() && Path::new(worktree_path).join(".git").exists()
}

/// A project directory need not be a git checkout, so unlike `is_worktree_present`
/// this checks presence only. Sync variant for `enrich_chat`, which runs under a
/// held lock; async variant for the (async, sync-I/O-banned) projects route.
pub fn is_directory_present(path: &str) -> bool {
    Path::new(path).is_dir()
}

pub async fn is_directory_present_async(path: &str) -> bool {
    tokio::fs::metadata(path).await.is_ok_and(|m| m.is_dir())
}

/// `refs/heads/feat/x` → `feat/x`. `strip_prefix`, not `replace`: a branch named
/// `feat/refs/heads/x` is legal and must survive intact.
pub fn short_branch(git_ref: &str) -> &str {
    git_ref.strip_prefix("refs/heads/").unwrap_or(git_ref)
}

pub async fn get_worktrees(project_path: &str) -> Vec<WorktreeEntry> {
    match run_worktree_git(
        &["worktree", "list", "--porcelain"],
        project_path,
        GitTimeout::Default,
    )
    .await
    {
        Ok(stdout) => parse_worktree_list(&stdout),
        // best-effort: not a git repo / no worktrees
        Err(_) => Vec::new(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeInfo {
    pub worktree_path: String,
    pub branch_name: String,
}

/// `<project>/<dir_name>/<branch with / as ->`, after creating its parent dir.
async fn prepare_worktree_path(
    project_path: &str,
    dir_name: &str,
    branch_name: &str,
) -> Result<String, WorktreeError> {
    let worktree_dir = Path::new(project_path).join(dir_name);
    tokio::fs::create_dir_all(&worktree_dir).await?;
    Ok(worktree_dir
        .join(branch_name.replace('/', "-"))
        .to_string_lossy()
        .into_owned())
}

pub async fn create_worktree(
    project_path: &str,
    dir_name: &str,
    base_branch: &str,
    branch_name: &str,
) -> Result<WorktreeInfo, WorktreeError> {
    let worktree_path_str = prepare_worktree_path(project_path, dir_name, branch_name).await?;
    // No timeout: `worktree add` can clone/checkout a large tree and run hooks.
    run_worktree_git(
        &[
            "worktree",
            "add",
            "-b",
            branch_name,
            &worktree_path_str,
            base_branch,
        ],
        project_path,
        GitTimeout::Unbounded,
    )
    .await?;
    Ok(WorktreeInfo {
        worktree_path: worktree_path_str,
        branch_name: branch_name.to_string(),
    })
}

/// Check an existing branch out into a new worktree at `create_worktree`'s path.
pub async fn checkout_worktree(
    project_path: &str,
    dir_name: &str,
    branch_name: &str,
) -> Result<WorktreeInfo, WorktreeError> {
    let worktree_path = prepare_worktree_path(project_path, dir_name, branch_name).await?;
    add_worktree_for_branch(project_path, &worktree_path, branch_name).await?;
    Ok(WorktreeInfo {
        worktree_path,
        branch_name: branch_name.to_string(),
    })
}

/// The linked worktree that has `branch_name` checked out, if its directory is
/// still there. Never the main checkout: the first entry `git worktree list`
/// prints, or `project_path` itself.
pub async fn find_branch_worktree(project_path: &str, branch_name: &str) -> Option<String> {
    get_worktrees(project_path)
        .await
        .into_iter()
        .skip(1)
        .filter(|wt| wt.path != project_path && is_worktree_present(&wt.path))
        .find(|wt| wt.branch.as_deref().map(short_branch) == Some(branch_name))
        .map(|wt| wt.path)
}

/// Git-only phase of the worktree backfill: over a snapshot of every project,
/// return the `(child_id, parent_id)` parent links that should be persisted. No
/// DB access, so a caller whose DB lives behind an async actor (the daemon) can
/// bridge the project read and the `set_parent_project` writes itself — a
/// `&ProjectsRepository` can't be held across the async `git worktree list` calls.
pub async fn compute_worktree_parent_links(all_projects: &[Project]) -> Vec<(String, String)> {
    let path_to_id: HashMap<String, String> = all_projects
        .iter()
        .map(|p| (p.path.clone(), p.id.clone()))
        .collect();

    let mut links = Vec::new();
    for project in all_projects {
        if has_parent(project) {
            continue;
        }
        let worktrees = get_worktrees(&project.path).await;
        for wt in worktrees {
            if wt.path == project.path {
                continue;
            }
            if let Some(child_id) = path_to_id.get(&wt.path)
                && let Some(child) = all_projects.iter().find(|p| &p.id == child_id)
                && !has_parent(child)
            {
                links.push((child_id.clone(), project.id.clone()));
            }
        }
    }
    links
}

/// Truthy check on `project.parentProjectId` (`string | null | undefined`):
/// a non-null, non-empty string.
fn has_parent(project: &Project) -> bool {
    matches!(&project.parent_project_id, Some(Some(p)) if !p.is_empty())
}

pub async fn branch_exists(project_path: &str, branch_name: &str) -> bool {
    let ref_arg = format!("refs/heads/{branch_name}");
    run_worktree_git(
        &["rev-parse", "--verify", "--quiet", &ref_arg],
        project_path,
        GitTimeout::Default,
    )
    .await
    // expected: branch missing → non-zero exit → Err
    .is_ok()
}

/// Re-add a previously deleted worktree at its original path, checking out an
/// existing branch.
pub async fn add_worktree_for_branch(
    project_path: &str,
    worktree_path: &str,
    branch_name: &str,
) -> Result<(), WorktreeError> {
    // Drop the stale registration git still holds for the deleted directory.
    // best-effort
    if let Err(error) =
        run_worktree_git(&["worktree", "prune"], project_path, GitTimeout::Default).await
    {
        tracing::warn!(%error, path = %project_path, operation = "worktree_prune", "failed to prune stale worktree references");
    }
    // No timeout: checkout of a large tree can exceed the default cap (see create_worktree).
    run_worktree_git(
        &["worktree", "add", worktree_path, branch_name],
        project_path,
        GitTimeout::Unbounded,
    )
    .await?;
    Ok(())
}

pub async fn remove_worktree(project_path: &str, worktree_path: &str, branch_name: &str) {
    if run_worktree_git(
        &["worktree", "remove", worktree_path, "--force"],
        project_path,
        GitTimeout::Default,
    )
    .await
    .is_err()
    {
        // best-effort: worktree dir may already be gone
        if let Err(error) = tokio::fs::remove_dir_all(worktree_path).await {
            tracing::warn!(%error, path = %worktree_path, "failed to remove worktree directory");
        }
        // best-effort
        if let Err(error) =
            run_worktree_git(&["worktree", "prune"], project_path, GitTimeout::Default).await
        {
            tracing::warn!(%error, path = %project_path, operation = "worktree_prune", "failed to prune removed worktree references");
        }
    }
    // best-effort: branch may not exist or may still be checked out elsewhere
    if let Err(error) = run_worktree_git(
        &["branch", "-D", branch_name],
        project_path,
        GitTimeout::Default,
    )
    .await
    {
        tracing::warn!(%error, path = %project_path, operation = "branch_delete", "failed to delete worktree branch");
    }
}

#[cfg(test)]
#[path = "worktree_tests.rs"]
mod tests;
