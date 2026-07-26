//! Git-host classification: root `.git/config` parsing, the no-remote and
//! no-`.git` cases, a symlinked `.git`, and the worktree-checkout case.

use std::fs;
use std::path::Path;
use tempfile::tempdir;

use mainframe_types::setup_advisor::GitHost;

use crate::setup_advisor::fingerprint::fingerprint;

fn write_files(root: &Path, files: &[(&str, &str)]) {
    for (path, contents) in files {
        let full = root.join(path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(full, contents).unwrap();
    }
}

#[tokio::test]
async fn classifies_a_gitlab_origin_as_gitlab() {
    let tmp = tempdir().unwrap();
    write_files(
        tmp.path(),
        &[(
            ".git/config",
            "[remote \"origin\"]\n\turl = git@gitlab.com:acme/app.git\n",
        )],
    );
    let fp = fingerprint(tmp.path()).await;
    assert_eq!(fp.git_host, Some(GitHost::Gitlab));
}

#[tokio::test]
async fn classifies_a_bitbucket_origin_as_other() {
    let tmp = tempdir().unwrap();
    write_files(
        tmp.path(),
        &[(
            ".git/config",
            "[remote \"origin\"]\n\turl = git@bitbucket.org:acme/app.git\n",
        )],
    );
    let fp = fingerprint(tmp.path()).await;
    assert_eq!(fp.git_host, Some(GitHost::Other));
}

#[tokio::test]
async fn a_project_with_no_git_directory_has_no_git_host() {
    let tmp = tempdir().unwrap();
    write_files(tmp.path(), &[("main.py", "print('hi')")]);
    let fp = fingerprint(tmp.path()).await;
    assert_eq!(fp.git_host, None);
}

#[tokio::test]
async fn a_git_config_with_no_remote_origin_section_has_no_git_host() {
    let tmp = tempdir().unwrap();
    write_files(
        tmp.path(),
        &[(".git/config", "[core]\n\trepositoryformatversion = 0\n")],
    );
    let fp = fingerprint(tmp.path()).await;
    assert_eq!(fp.git_host, None);
}

#[tokio::test]
async fn does_not_follow_a_dot_git_symlinked_outside_the_project() {
    // Security: the out-of-root config below WOULD classify as GitHub if
    // followed, so this proves containment rather than an accidental miss.
    let outside = tempdir().unwrap();
    fs::create_dir_all(outside.path().join("real-git")).unwrap();
    fs::write(
        outside.path().join("real-git/config"),
        "[remote \"origin\"]\n\turl = git@github.com:acme/app.git\n",
    )
    .unwrap();

    let project = tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path().join("real-git"), project.path().join(".git"))
        .unwrap();

    let fp = fingerprint(project.path()).await;

    assert_eq!(fp.git_host, None);
}

#[tokio::test]
async fn a_worktree_checkout_with_a_dot_git_file_has_no_git_host() {
    // Intentional: worktree checkouts (`.git` is a file pointing at the real
    // repo's `.git/worktrees/<name>`) get no remote-derived recommendations.
    // This is a deliberate product decision, not a gap to "fix" later.
    let tmp = tempdir().unwrap();
    write_files(
        tmp.path(),
        &[(".git", "gitdir: /somewhere/outside/.git/worktrees/x\n")],
    );
    let fp = fingerprint(tmp.path()).await;
    assert_eq!(fp.git_host, None);
}
