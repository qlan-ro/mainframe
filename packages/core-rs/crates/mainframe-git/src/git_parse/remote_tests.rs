use super::*;

#[test]
fn parse_remotes_single() {
    assert_eq!(parse_remotes("origin\n"), vec!["origin".to_string()]);
}

#[test]
fn parse_remotes_multiple_trims() {
    assert_eq!(
        parse_remotes("origin\nupstream\n"),
        vec!["origin".to_string(), "upstream".to_string()]
    );
}

#[test]
fn parse_remotes_empty() {
    assert_eq!(parse_remotes(""), Vec::<String>::new());
}

#[test]
fn parse_remote_urls_dedupes_fetch_and_push() {
    let output = "origin\thttps://github.com/o/r.git (fetch)\n\
                   origin\thttps://github.com/o/r.git (push)\n";
    assert_eq!(
        parse_remote_urls(output),
        vec![RemoteUrl {
            name: "origin".to_string(),
            url: "https://github.com/o/r.git".to_string(),
        }]
    );
}

#[test]
fn parse_remote_urls_preserves_order_across_multiple_remotes() {
    let output = "origin\thttps://github.com/o/r.git (fetch)\n\
                   origin\thttps://github.com/o/r.git (push)\n\
                   upstream\tgit@github.com:x/y.git (fetch)\n\
                   upstream\tgit@github.com:x/y.git (push)\n";
    assert_eq!(
        parse_remote_urls(output),
        vec![
            RemoteUrl {
                name: "origin".to_string(),
                url: "https://github.com/o/r.git".to_string(),
            },
            RemoteUrl {
                name: "upstream".to_string(),
                url: "git@github.com:x/y.git".to_string(),
            },
        ]
    );
}

#[test]
fn parse_remote_urls_empty() {
    assert_eq!(parse_remote_urls(""), Vec::<RemoteUrl>::new());
}

fn repo(owner: &str, repo: &str) -> GitHubRepoRef {
    GitHubRepoRef {
        owner: owner.to_string(),
        repo: repo.to_string(),
    }
}

#[test]
fn github_repo_from_url_https_no_suffix() {
    assert_eq!(
        github_repo_from_url("https://github.com/o/r"),
        Some(repo("o", "r"))
    );
}

#[test]
fn github_repo_from_url_https_dot_git_suffix() {
    assert_eq!(
        github_repo_from_url("https://github.com/o/r.git"),
        Some(repo("o", "r"))
    );
}

#[test]
fn github_repo_from_url_scp_like_syntax() {
    assert_eq!(
        github_repo_from_url("git@github.com:o/r.git"),
        Some(repo("o", "r"))
    );
}

#[test]
fn github_repo_from_url_ssh_scheme() {
    assert_eq!(
        github_repo_from_url("ssh://git@github.com/o/r.git"),
        Some(repo("o", "r"))
    );
}

#[test]
fn github_repo_from_url_rejects_non_github_host() {
    assert_eq!(github_repo_from_url("https://gitlab.com/o/r.git"), None);
}

#[test]
fn github_repo_from_url_rejects_too_few_segments() {
    assert_eq!(github_repo_from_url("https://github.com/o"), None);
}

#[test]
fn github_repo_from_url_rejects_too_many_segments() {
    assert_eq!(github_repo_from_url("https://github.com/o/r/extra"), None);
}

#[test]
fn github_repo_from_url_rejects_ext_transport() {
    assert_eq!(
        github_repo_from_url("ext::sh -c 'ssh %S github.com o/r'"),
        None
    );
}

#[test]
fn github_repo_from_url_rejects_file_transport() {
    assert_eq!(github_repo_from_url("file:///tmp/o/r"), None);
}

#[test]
fn github_repo_from_url_rejects_invalid_segment_characters() {
    assert_eq!(github_repo_from_url("https://github.com/o/r$"), None);
}

#[test]
fn github_repo_from_url_rejects_dot_segments() {
    assert_eq!(github_repo_from_url("https://github.com/../.."), None);
    assert_eq!(github_repo_from_url("git@github.com:owner/..git"), None);
    assert!(!is_valid_repo_segment("."));
    assert!(!is_valid_repo_segment(".."));
    assert!(is_valid_repo_segment(".github"));
}
