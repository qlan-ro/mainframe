//! Ported from `src/workspace/worktree.ts`.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use mainframe_db::ProjectsRepository;
use mainframe_types::chat::Project;
use serde::{Deserialize, Serialize};

/// Default `execGit` timeout (30s). `0` means no timeout — for genuinely
/// long-running operations such as `worktree add`.
const DEFAULT_GIT_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, thiserror::Error)]
pub enum WorktreeError {
    #[error("{0}")]
    Git(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Db(#[from] mainframe_db::DbError),
}

/// Local faithful port of `src/server/routes/exec-git.ts` (`execGit`).
///
// TODO(port): replace with `mainframe_git::exec_git` once §2.4 lands — that
// crate is still an empty placeholder, so worktree.ts's git callers use this
// duplicate helper for now.
async fn exec_git(args: &[&str], cwd: &str, timeout_ms: u64) -> Result<String, WorktreeError> {
    // Mirror `await access(cwd)` → throw `Directory not accessible: ${cwd}`.
    if tokio::fs::metadata(cwd).await.is_err() {
        return Err(WorktreeError::Git(format!(
            "Directory not accessible: {cwd}"
        )));
    }
    let mut cmd = tokio::process::Command::new("git");
    cmd.args(args).current_dir(cwd).kill_on_drop(true);

    let output = if timeout_ms == 0 {
        cmd.output().await?
    } else {
        match tokio::time::timeout(Duration::from_millis(timeout_ms), cmd.output()).await {
            Ok(result) => result?,
            Err(_) => return Err(WorktreeError::Git("git command timed out".to_string())),
        }
    };

    if !output.status.success() {
        // execFileAsync rejects on a non-zero exit.
        return Err(WorktreeError::Git(
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorktreeEntry {
    pub path: String,
    // `branch: string | null` — serialize null (not omitted) to mirror the TS shape.
    pub branch: Option<String>,
}

/// True when `worktreePath` is a usable git worktree: the directory exists AND
/// carries a `.git` entry. Guards against orphaned stub dirs.
pub fn is_worktree_present(worktree_path: &str) -> bool {
    Path::new(worktree_path).exists() && Path::new(worktree_path).join(".git").exists()
}

pub fn parse_worktree_list(output: &str) -> Vec<WorktreeEntry> {
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;

    for line in output.split('\n') {
        if let Some(rest) = line.strip_prefix("worktree ") {
            current_path = Some(rest.to_string());
            current_branch = None;
        } else if let Some(rest) = line.strip_prefix("branch ") {
            current_branch = Some(rest.to_string());
        } else if line == "detached" {
            current_branch = None;
        } else if line.is_empty() && current_path.is_some() {
            entries.push(WorktreeEntry {
                path: current_path.take().unwrap_or_default(),
                branch: current_branch.take(),
            });
            current_path = None;
            current_branch = None;
        }
    }

    entries
}

pub async fn get_worktrees(project_path: &str) -> Vec<WorktreeEntry> {
    match exec_git(
        &["worktree", "list", "--porcelain"],
        project_path,
        DEFAULT_GIT_TIMEOUT_MS,
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

pub async fn create_worktree(
    project_path: &str,
    dir_name: &str,
    base_branch: &str,
    branch_name: &str,
) -> Result<WorktreeInfo, WorktreeError> {
    let sanitized_branch = branch_name.replace('/', "-");
    let worktree_dir = Path::new(project_path).join(dir_name);
    let worktree_path = worktree_dir.join(&sanitized_branch);
    let worktree_path_str = worktree_path.to_string_lossy().into_owned();

    tokio::fs::create_dir_all(&worktree_dir).await?;
    // No timeout: `worktree add` can clone/checkout a large tree and run hooks.
    exec_git(
        &[
            "worktree",
            "add",
            "-b",
            branch_name,
            &worktree_path_str,
            base_branch,
        ],
        project_path,
        0,
    )
    .await?;
    Ok(WorktreeInfo {
        worktree_path: worktree_path_str,
        branch_name: branch_name.to_string(),
    })
}

pub async fn backfill_worktree_relationships(
    projects: &ProjectsRepository,
) -> Result<(), WorktreeError> {
    let all_projects = projects.list()?;
    for (child_id, parent_id) in compute_worktree_parent_links(&all_projects).await {
        tracing::info!(
            module = "worktree-backfill",
            child_id = %child_id,
            parent_id = %parent_id,
            "Backfilling worktree relationship"
        );
        projects.set_parent_project(&child_id, &parent_id)?;
    }
    Ok(())
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

pub async fn remove_worktree(project_path: &str, worktree_path: &str, branch_name: &str) {
    if exec_git(
        &["worktree", "remove", worktree_path, "--force"],
        project_path,
        DEFAULT_GIT_TIMEOUT_MS,
    )
    .await
    .is_err()
    {
        // best-effort: worktree dir may already be gone
        let _ = tokio::fs::remove_dir_all(worktree_path).await;
        // best-effort
        let _ = exec_git(&["worktree", "prune"], project_path, DEFAULT_GIT_TIMEOUT_MS).await;
    }
    // best-effort: branch may not exist or may still be checked out elsewhere
    let _ = exec_git(
        &["branch", "-D", branch_name],
        project_path,
        DEFAULT_GIT_TIMEOUT_MS,
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn present_true_for_linked_worktree_git_file_pointer() {
        let dir = tempfile::tempdir().unwrap();
        let wt = dir.path().join("linked");
        tokio::fs::create_dir(&wt).await.unwrap();
        tokio::fs::write(wt.join(".git"), "gitdir: /repo/.git/worktrees/linked\n")
            .await
            .unwrap();
        assert!(is_worktree_present(wt.to_str().unwrap()));
    }

    #[tokio::test]
    async fn present_true_for_main_checkout_git_directory() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        tokio::fs::create_dir_all(repo.join(".git")).await.unwrap();
        assert!(is_worktree_present(repo.to_str().unwrap()));
    }

    #[tokio::test]
    async fn present_false_for_orphaned_stub_dir() {
        let dir = tempfile::tempdir().unwrap();
        let stub = dir.path().join("agent-stub");
        tokio::fs::create_dir(&stub).await.unwrap();
        assert!(!is_worktree_present(stub.to_str().unwrap()));
    }

    #[test]
    fn present_false_for_path_that_does_not_exist() {
        assert!(!is_worktree_present("/definitely/does/not/exist/nope"));
    }

    #[test]
    fn parses_porcelain_output_into_worktree_entries() {
        let output = [
            "worktree /Users/dev/my-project",
            "HEAD abc1234",
            "branch refs/heads/main",
            "",
            "worktree /Users/dev/my-project/.worktrees/feat-x",
            "HEAD def5678",
            "branch refs/heads/feat-x",
            "",
        ]
        .join("\n");

        let entries = parse_worktree_list(&output);
        assert_eq!(
            entries,
            vec![
                WorktreeEntry {
                    path: "/Users/dev/my-project".to_string(),
                    branch: Some("refs/heads/main".to_string()),
                },
                WorktreeEntry {
                    path: "/Users/dev/my-project/.worktrees/feat-x".to_string(),
                    branch: Some("refs/heads/feat-x".to_string()),
                },
            ]
        );
    }

    #[test]
    fn handles_detached_head_entries() {
        let output = [
            "worktree /Users/dev/repo",
            "HEAD abc1234",
            "branch refs/heads/main",
            "",
            "worktree /Users/dev/repo/.worktrees/detached",
            "HEAD def5678",
            "detached",
            "",
        ]
        .join("\n");

        let entries = parse_worktree_list(&output);
        assert_eq!(
            entries,
            vec![
                WorktreeEntry {
                    path: "/Users/dev/repo".to_string(),
                    branch: Some("refs/heads/main".to_string()),
                },
                WorktreeEntry {
                    path: "/Users/dev/repo/.worktrees/detached".to_string(),
                    branch: None,
                },
            ]
        );
    }

    #[test]
    fn returns_empty_array_for_empty_input() {
        assert_eq!(parse_worktree_list(""), Vec::new());
    }
}

// PORT STATUS: src/workspace/worktree.ts (125 lines)
// confidence: medium
// todos: 1
// notes: parseWorktreeList / isWorktreePresent are exact ports (isWorktreePresent
// keeps the intentional sync existsSync via Path::exists). exec_git is a LOCAL
// faithful port of exec-git.ts (mainframe_git::exec_git §2.4 not yet ported —
// TODO(port) marks the swap). backfill takes &ProjectsRepository (mainframe-db,
// Rc<Connection> → !Send): the future is !Send, fine while un-spawned; a later
// phase wraps the DB in a Send handle. has_parent mirrors the JS truthy check on
// parentProjectId (non-null, non-empty). remove_worktree returns () (all steps
// best-effort, swallowed like the TS). Tests ported from worktree.test.ts.
