use super::*;

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

#[test]
fn parse_numstat_z_reads_counts_renames_and_binaries() {
    let output = "3\t1\tsrc/a.rs\0-\t-\tlogo.png\x002\t0\t\0old name.rs\0new name.rs\0";
    let file = |path: &str, additions, deletions| WorkingStatFile {
        path: path.to_string(),
        additions,
        deletions,
    };
    assert_eq!(
        parse_numstat_z(output),
        vec![
            file("src/a.rs", 3, 1),
            file("logo.png", 0, 0),
            file("new name.rs", 2, 0),
        ]
    );
}

#[test]
fn parse_numstat_z_empty() {
    assert_eq!(parse_numstat_z(""), Vec::new());
}
