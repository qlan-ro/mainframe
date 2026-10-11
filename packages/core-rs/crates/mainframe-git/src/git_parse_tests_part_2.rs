// ---- parseRemotes ----

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

// ---- parseRemoteUrls ----

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

// ---- githubRepoFromUrl ----

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

// ---- parseCommitHash ----

#[test]
fn parse_commit_hash_full_sha() {
    assert_eq!(
        parse_commit_hash("[main 4eb25962344372bd1543bcb51fb6f8eb28503c03] second"),
        "4eb25962344372bd1543bcb51fb6f8eb28503c03"
    );
}

#[test]
fn parse_commit_hash_root_commit() {
    assert_eq!(
        parse_commit_hash("[main (root-commit) 56a25fa0b22e6620abbc9cd6ba8aab04f94039fc] initial"),
        "56a25fa0b22e6620abbc9cd6ba8aab04f94039fc"
    );
}

#[test]
fn parse_commit_hash_reads_first_line() {
    assert_eq!(
        parse_commit_hash(
            "[main 4eb25962344372bd1543bcb51fb6f8eb28503c03] second\n 1 file changed, 1 insertion(+)"
        ),
        "4eb25962344372bd1543bcb51fb6f8eb28503c03"
    );
}

#[test]
fn parse_commit_hash_empty_when_no_commit_line() {
    assert_eq!(
        parse_commit_hash("nothing to commit, working tree clean"),
        ""
    );
    assert_eq!(parse_commit_hash(""), "");
}

// ---- parseDiffStatSummary ----

#[test]
fn parse_diff_stat_summary_insertions_only() {
    assert_eq!(
        parse_diff_stat_summary("1 file changed, 1 insertion(+)"),
        DiffStatSummary {
            changes: 1,
            insertions: 1,
            deletions: 0
        }
    );
}

#[test]
fn parse_diff_stat_summary_full() {
    assert_eq!(
        parse_diff_stat_summary("3 files changed, 10 insertions(+), 2 deletions(-)"),
        DiffStatSummary {
            changes: 3,
            insertions: 10,
            deletions: 2
        }
    );
}

#[test]
fn parse_diff_stat_summary_deletions_only() {
    assert_eq!(
        parse_diff_stat_summary("2 files changed, 5 deletions(-)"),
        DiffStatSummary {
            changes: 2,
            insertions: 0,
            deletions: 5
        }
    );
}

#[test]
fn parse_diff_stat_summary_inside_merge_output() {
    let output =
        "Merge made by the 'ort' strategy.\n f.txt | 1 +\n 1 file changed, 1 insertion(+)\n";
    assert_eq!(
        parse_diff_stat_summary(output),
        DiffStatSummary {
            changes: 1,
            insertions: 1,
            deletions: 0
        }
    );
}

#[test]
fn parse_diff_stat_summary_up_to_date() {
    assert_eq!(
        parse_diff_stat_summary("Already up to date."),
        DiffStatSummary {
            changes: 0,
            insertions: 0,
            deletions: 0
        }
    );
}

#[test]
fn parse_diff_stat_summary_empty() {
    assert_eq!(
        parse_diff_stat_summary(""),
        DiffStatSummary {
            changes: 0,
            insertions: 0,
            deletions: 0
        }
    );
}

// ---- countAutoMerges ----

#[test]
fn count_auto_merges_counts_each_line() {
    let output = "Auto-merging src/a.ts\nAuto-merging src/b.ts\nMerge made by the 'ort' strategy.";
    assert_eq!(count_auto_merges(output), 2);
}

#[test]
fn count_auto_merges_zero_for_clean_merge() {
    assert_eq!(
        count_auto_merges("Merge made by the 'ort' strategy.\n f.txt | 1 +"),
        0
    );
}

#[test]
fn count_auto_merges_zero_for_empty() {
    assert_eq!(count_auto_merges(""), 0);
}

// ---- parseStatusZ ----

fn status_file(path: &str, index: &str, working_dir: &str) -> StatusFile {
    StatusFile {
        path: path.to_string(),
        index: index.to_string(),
        working_dir: working_dir.to_string(),
    }
}
