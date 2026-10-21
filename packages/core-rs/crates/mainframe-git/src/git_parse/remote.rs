//! `git remote` parsers and GitHub `owner/repo` extraction.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// Remote names from `git remote` (one per line).
pub fn parse_remotes(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

/// A named remote and its URL, as reported by `git remote -v`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteUrl {
    pub name: String,
    pub url: String,
}

/// Parses `git remote -v` output (`<name>\t<url> (fetch|push)` per line) into
/// one entry per distinct name/URL pair, in first-seen order. Each remote
/// normally prints its URL twice (fetch and push); this dedupes that pair
/// rather than exposing direction.
pub fn parse_remote_urls(output: &str) -> Vec<RemoteUrl> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for line in output.lines() {
        let Some((name, rest)) = line.trim().split_once('\t') else {
            continue;
        };
        let rest = rest.trim();
        let url = rest.rsplit_once(' ').map_or(rest, |(u, _)| u);
        if name.is_empty() || url.is_empty() {
            continue;
        }
        if seen.insert((name, url)) {
            result.push(RemoteUrl {
                name: name.to_string(),
                url: url.to_string(),
            });
        }
    }
    result
}

/// An `owner/repo` pair derived from a GitHub remote URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHubRepoRef {
    pub owner: String,
    pub repo: String,
}

/// Extracts `owner/repo` from a GitHub remote URL, accepting the four shapes
/// `git remote -v` can print: `https://github.com/o/r[.git]`,
/// `git@github.com:o/r.git` (scp-like syntax), and `ssh://git@github.com/o/r.git`.
/// Rejects any other host, a path with fewer or more than two segments, a
/// foreign-transport prefix (`ext::`, `file::`/`file://`), and a segment
/// containing anything outside `[A-Za-z0-9._-]`.
pub fn github_repo_from_url(url: &str) -> Option<GitHubRepoRef> {
    let url = url.trim();
    if url.starts_with("ext::") || url.starts_with("file::") || url.starts_with("file://") {
        return None;
    }
    let path = url
        .strip_prefix("git@github.com:")
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))
        .or_else(|| url.strip_prefix("https://github.com/"))
        .or_else(|| url.strip_prefix("http://github.com/"))?;
    let path = path.strip_suffix(".git").unwrap_or(path);
    let path = path.trim_end_matches('/');
    let mut segments = path.split('/');
    let owner = segments.next()?;
    let repo = segments.next()?;
    if segments.next().is_some() {
        return None;
    }
    if !is_valid_repo_segment(owner) || !is_valid_repo_segment(repo) {
        return None;
    }
    Some(GitHubRepoRef {
        owner: owner.to_string(),
        repo: repo.to_string(),
    })
}

/// Rejects anything outside `[A-Za-z0-9._-]` — the shape GitHub itself
/// enforces for an owner or repo name — and the dot segments `.` and `..`,
/// which a URL resolves as path navigation. Any caller that accepts an
/// `owner`/`repo` pair from outside this module (route input, stored
/// config, …) must run it through here before the value reaches a URL or a
/// process argument.
pub fn is_valid_repo_segment(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

#[cfg(test)]
#[path = "remote_tests.rs"]
mod tests;
