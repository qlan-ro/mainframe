//! Classifies the project's `origin` remote from the root `.git/config`.

use std::path::Path;

use mainframe_types::setup_advisor::GitHost;

use super::manifests::read_contained_root_file;

/// Reads the `origin` remote out of `<real_root>/.git/config` and classifies its
/// host. `None` when there is no `.git`, no origin, or the config resolves
/// outside the project.
pub(super) async fn detect_git_host(real_root: &Path) -> Option<GitHost> {
    let meta = tokio::fs::metadata(real_root.join(".git")).await.ok()?;
    // A `.git` file is a `gitdir:` pointer into another checkout (worktree or
    // submodule); those get no remote-derived recommendations by decision.
    if !meta.is_dir() {
        return None;
    }
    let config = read_contained_root_file(real_root, ".git/config").await?;
    Some(classify(origin_url(&config)?))
}

/// Minimal INI scan for the `url` of the first `[remote "origin"]` section.
/// Full git-config semantics (includes, multivars) are out of scope: the host
/// substring is all the fingerprint needs.
fn origin_url(config: &str) -> Option<&str> {
    let mut in_origin = false;
    for line in config.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_origin = line.starts_with("[remote \"origin\"]");
            continue;
        }
        if !in_origin {
            continue;
        }
        if let Some(value) = line.strip_prefix("url").map(str::trim_start)
            && let Some(url) = value.strip_prefix('=')
        {
            return Some(url.trim());
        }
    }
    None
}

fn classify(url: &str) -> GitHost {
    if url.contains("github.com") {
        GitHost::Github
    } else if url.contains("gitlab.com") {
        GitHost::Gitlab
    } else {
        GitHost::Other
    }
}
