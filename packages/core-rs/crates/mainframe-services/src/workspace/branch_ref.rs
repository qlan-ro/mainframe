use mainframe_git::git_exec::{GitTimeout, exec_git};

pub async fn is_branch_start_point(project: &str, start: &str) -> bool {
    if start == "HEAD" {
        return false;
    }
    exec_git(
        &[
            "rev-parse",
            "--symbolic-full-name",
            "--verify",
            "--end-of-options",
            start,
        ],
        project,
        GitTimeout::Default,
    )
    .await
    .is_ok_and(|reference| {
        let name = reference.trim_end_matches('\n');
        ["refs/heads/", "refs/remotes/"].into_iter().any(|prefix| {
            name.strip_prefix(prefix)
                .is_some_and(|short| short == start || name == start)
        })
    })
}
