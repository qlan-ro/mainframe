//! Ported from `packages/core/src/git/git-parse.ts`.
//!
//! Shared git output parsers used by route handlers and GitService. These are
//! the porcelain spec — every fixture string is preserved byte-identically in
//! the ported tests.

use serde::{Deserialize, Serialize};

use crate::git_exec::GitExecError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffEntry {
    pub status: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusBuckets {
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BranchList {
    pub current: String,
    pub all: Vec<String>,
}

// `working_dir` is intentionally snake_case (matching the TS field name, which
// mirrors simple-git's FileStatusResult) — no camelCase rename.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusFile {
    pub path: String,
    pub index: String,
    pub working_dir: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PorcelainStatus {
    pub conflicted: Vec<String>,
    pub files: Vec<StatusFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffStatSummary {
    pub changes: i64,
    pub insertions: i64,
    pub deletions: i64,
}

/// Returns true when an error originates from running git in a non-repo
/// directory. Used to suppress noisy warnings for expected "not a git
/// repository" failures.
///
/// The TS signature took `unknown` and guarded `typeof err.message === 'string'`
/// (so raw strings/numbers returned false); Rust's typed `&GitExecError` makes
/// those dynamic-typing cases inexpressible.
pub fn is_not_git_repo(err: &GitExecError) -> bool {
    err.message.contains("not a git repository")
}

/// Parses `git diff --name-status` output (tab-separated) into structured
/// entries. Renamed (R) and copied (C) entries carry an `old_path`.
pub fn parse_diff_name_status(output: &str) -> Vec<DiffEntry> {
    output
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            let status = parts.first().copied().unwrap_or("");
            if status.starts_with('R') || status.starts_with('C') {
                DiffEntry {
                    status: status.chars().next().map(String::from).unwrap_or_default(),
                    path: parts.get(2).copied().unwrap_or("").to_string(),
                    old_path: parts.get(1).map(|s| s.to_string()),
                }
            } else {
                DiffEntry {
                    status: status.to_string(),
                    path: parts.get(1).copied().unwrap_or("").to_string(),
                    old_path: None,
                }
            }
        })
        .filter(|f| !f.path.is_empty())
        .collect()
}

/// Parses `git status --porcelain` output into structured file entries.
/// Each line's first two characters are the XY status code; the rest (after 3
/// chars) is the path. Renamed (R) and copied (C) entries use " -> " to
/// separate old and new paths. Directory entries (trailing slash) are filtered.
pub fn parse_status_lines(output: &str) -> Vec<DiffEntry> {
    output
        .split('\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            let code = line.chars().take(2).collect::<String>().trim().to_string();
            let rest: String = line.chars().skip(3).collect();
            if (code.starts_with('R') || code.starts_with('C'))
                && let Some(arrow) = rest.find(" -> ")
            {
                return DiffEntry {
                    status: code,
                    path: rest[arrow + 4..].to_string(),
                    old_path: Some(rest[..arrow].to_string()),
                };
            }
            DiffEntry {
                status: code,
                path: rest,
                old_path: None,
            }
        })
        .filter(|f| !f.path.ends_with('/'))
        .collect()
}

/// Parses `git status --porcelain` output into staged/unstaged/untracked
/// buckets. Uses the two-character XY format: X = index status, Y = working-tree
/// status.
pub fn parse_status_buckets(output: &str) -> StatusBuckets {
    let mut staged: Vec<String> = Vec::new();
    let mut unstaged: Vec<String> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();

    for line in output.split('\n').filter(|l| !l.is_empty()) {
        let index_status = line.chars().next().unwrap_or(' ');
        let working_status = line.chars().nth(1).unwrap_or(' ');
        let filename: String = line.chars().skip(3).collect();

        if index_status == '?' && working_status == '?' {
            untracked.push(filename);
            continue;
        }
        if index_status != ' ' {
            staged.push(filename.clone());
        }
        if working_status != ' ' {
            unstaged.push(filename);
        }
    }

    StatusBuckets {
        staged,
        unstaged,
        untracked,
    }
}

/// Parses `git branch --no-color [-a]` output into the current branch and the
/// full list of branch names. Remote branches keep their `remotes/<remote>/...`
/// prefix; the `remotes/origin/HEAD -> origin/main` pointer keeps its name so
/// callers can filter it. Detached HEAD lines resolve to the ref they point at.
pub fn parse_branch_list(output: &str) -> BranchList {
    let mut all: Vec<String> = Vec::new();
    let mut current = String::new();
    for line in output.split('\n') {
        if line.trim().is_empty() {
            continue;
        }
        let is_current = line.starts_with("* ");
        let rest = strip_branch_marker(line);
        let name = match parse_detached(rest) {
            Some(sha) => sha,
            None => rest.split_whitespace().next().unwrap_or("").to_string(),
        };
        if name.is_empty() {
            continue;
        }
        all.push(name.clone());
        if is_current {
            current = name;
        }
    }
    BranchList { current, all }
}

/// Mirrors `line.replace(/^[*+]?\s+/, '')`: strip an optional leading `*`/`+`
/// marker followed by one-or-more whitespace. No match (e.g. marker with no
/// trailing whitespace) leaves the line untouched.
fn strip_branch_marker(line: &str) -> &str {
    let marker_len = match line.chars().next() {
        Some(c) if c == '*' || c == '+' => c.len_utf8(),
        _ => 0,
    };
    let after_marker = &line[marker_len..];
    let ws_len: usize = after_marker
        .chars()
        .take_while(|c| c.is_whitespace())
        .map(|c| c.len_utf8())
        .sum();
    if ws_len == 0 {
        line
    } else {
        &line[marker_len + ws_len..]
    }
}

/// Mirrors `/^\((?:HEAD )?detached (?:from|at) (\S+)\)/`: resolve a detached-HEAD
/// line to the ref it points at.
fn parse_detached(rest: &str) -> Option<String> {
    let inner = rest.strip_prefix('(')?;
    let inner = inner.strip_prefix("HEAD ").unwrap_or(inner);
    let after = inner
        .strip_prefix("detached from ")
        .or_else(|| inner.strip_prefix("detached at "))?;
    let run: String = after.chars().take_while(|c| !c.is_whitespace()).collect();
    let sha = run.strip_suffix(')')?;
    if sha.is_empty() {
        return None;
    }
    Some(sha.to_string())
}

/// Branch names from `git remote` (one per line).
pub fn parse_remotes(output: &str) -> Vec<String> {
    output
        .split('\n')
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

/// Extracts the commit hash from `git commit` output, whose first line is
/// `[<branch> (root-commit)? <hash>] <subject>`. Returns '' when absent.
/// `-c core.abbrev=40` makes the hash the full sha.
pub fn parse_commit_hash(output: &str) -> String {
    for line in output.split('\n') {
        if let Some(hash) = match_commit_line(line) {
            return hash;
        }
    }
    String::new()
}

// Mirrors `/^\[[^\s]+(?: \([^)]+\))? ([^\]]+)\]/`.
fn match_commit_line(line: &str) -> Option<String> {
    let s = line.strip_prefix('[')?;
    // [^\s]+ branch
    let branch_end = s.find(char::is_whitespace)?;
    if branch_end == 0 {
        return None;
    }
    let mut rest = &s[branch_end..];
    // Optional " (root-commit)" group: ` \([^)]+\)`.
    if let Some(after_group) = match_root_group(rest) {
        rest = after_group;
    }
    // Literal ' ' before the capture.
    let rest = rest.strip_prefix(' ')?;
    // ([^\]]+) up to ']'.
    let close = rest.find(']')?;
    if close == 0 {
        return None;
    }
    Some(rest[..close].trim().to_string())
}

fn match_root_group(rest: &str) -> Option<&str> {
    let r = rest.strip_prefix(' ')?;
    let r = r.strip_prefix('(')?;
    let close = r.find(')')?;
    if close == 0 {
        return None;
    }
    Some(&r[close + 1..])
}

/// Parses the diffstat summary line git prints for pull/merge, e.g.
/// `3 files changed, 10 insertions(+), 2 deletions(-)`. Missing insertion or
/// deletion clauses count as 0. `changes` is the "N files changed" count.
pub fn parse_diff_stat_summary(output: &str) -> DiffStatSummary {
    for line in output.split('\n') {
        if let Some(summary) = match_diff_stat(line) {
            return summary;
        }
    }
    DiffStatSummary {
        changes: 0,
        insertions: 0,
        deletions: 0,
    }
}

// Mirrors `/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/`.
fn match_diff_stat(line: &str) -> Option<DiffStatSummary> {
    let bytes = line.as_bytes();
    for start in 0..line.len() {
        if !bytes[start].is_ascii_digit() {
            continue;
        }
        if let Some(summary) = try_diff_stat_at(&line[start..]) {
            return Some(summary);
        }
    }
    None
}

fn try_diff_stat_at(rest: &str) -> Option<DiffStatSummary> {
    let (changes, rest) = take_digits(rest)?;
    let rest = rest.strip_prefix(" file")?;
    let rest = rest.strip_prefix('s').unwrap_or(rest);
    let after_changed = rest.strip_prefix(" changed")?;

    let mut insertions = 0i64;
    let mut deletions = 0i64;
    let mut cur = after_changed;
    if let Some((n, r)) = try_stat_clause(cur, "insertion", "(+)") {
        insertions = n;
        cur = r;
    }
    if let Some((n, _r)) = try_stat_clause(cur, "deletion", "(-)") {
        deletions = n;
    }
    Some(DiffStatSummary {
        changes,
        insertions,
        deletions,
    })
}

// Mirrors `, (\d+) <word>s?<suffix>`.
fn try_stat_clause<'a>(s: &'a str, word: &str, suffix: &str) -> Option<(i64, &'a str)> {
    let r = s.strip_prefix(", ")?;
    let (n, r) = take_digits(r)?;
    let r = r.strip_prefix(' ')?;
    let r = r.strip_prefix(word)?;
    let r = r.strip_prefix('s').unwrap_or(r);
    let r = r.strip_prefix(suffix)?;
    Some((n, r))
}

// `(\d+)` — one-or-more leading ASCII digits; `parseInt(x, 10) || 0`.
fn take_digits(s: &str) -> Option<(i64, &str)> {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    if end == 0 {
        return None;
    }
    let n = s[..end].parse::<i64>().unwrap_or(0);
    Some((n, &s[end..]))
}

/// Count of `Auto-merging <file>` lines git prints during a merge.
pub fn count_auto_merges(output: &str) -> usize {
    output
        .split('\n')
        .filter(|l| l.starts_with("Auto-merging "))
        .count()
}

const CONFLICT_CODES: [&str; 7] = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];

/// Parses NUL-separated `git status --porcelain -z` output into per-file entries
/// (index/working-dir status chars) plus the conflicted-path list. Renamed and
/// copied entries consume the following NUL-separated old-path token. The
/// conflicted set is git's both-modified/unmerged XY codes.
pub fn parse_status_z(output: &str) -> PorcelainStatus {
    let mut files: Vec<StatusFile> = Vec::new();
    let mut conflicted: Vec<String> = Vec::new();
    let tokens: Vec<&str> = output.split('\0').collect();
    let mut i = 0;
    while i < tokens.len() {
        let entry = tokens[i];
        if entry.is_empty() {
            i += 1;
            continue;
        }
        let index = entry.chars().next().unwrap_or(' ');
        let working = entry.chars().nth(1).unwrap_or(' ');
        let path: String = entry.chars().skip(3).collect();
        let code = format!("{index}{working}");
        // Renamed/copied entries carry the source path in the next NUL token.
        if index == 'R' || index == 'C' {
            i += 1;
        }
        if code == "!!" {
            i += 1;
            continue;
        }
        files.push(StatusFile {
            path: path.clone(),
            index: index.to_string(),
            working_dir: working.to_string(),
        });
        if CONFLICT_CODES.contains(&code.as_str()) {
            conflicted.push(path);
        }
        i += 1;
    }
    PorcelainStatus { conflicted, files }
}

/// `parseInt(s, 10) || 0` — leading-digit parse with a NaN→0 fallback, matching
/// JS. Handles an optional leading `-` and leading whitespace.
pub(crate) fn js_parse_int(s: &str) -> i64 {
    let t = s.trim_start();
    let (neg, t) = match t.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, t),
    };
    let digits: String = t.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return 0;
    }
    let n = digits.parse::<i64>().unwrap_or(0);
    if neg { -n } else { n }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err(message: &str) -> GitExecError {
        GitExecError {
            message: message.to_string(),
            code: None,
            stdout: None,
            stderr: None,
        }
    }

    fn diff(status: &str, path: &str) -> DiffEntry {
        DiffEntry {
            status: status.to_string(),
            path: path.to_string(),
            old_path: None,
        }
    }

    fn diff_renamed(status: &str, path: &str, old_path: &str) -> DiffEntry {
        DiffEntry {
            status: status.to_string(),
            path: path.to_string(),
            old_path: Some(old_path.to_string()),
        }
    }

    // ---- isNotGitRepo ----

    #[test]
    fn is_not_git_repo_true_for_not_a_git_repository() {
        let e = err("fatal: not a git repository (or any of the parent directories): .git");
        assert!(is_not_git_repo(&e));
    }

    #[test]
    fn is_not_git_repo_false_for_other_errors() {
        let e = err("Permission denied");
        assert!(!is_not_git_repo(&e));
    }

    // ---- parseDiffNameStatus ----

    #[test]
    fn parse_diff_name_status_simple_modified() {
        assert_eq!(
            parse_diff_name_status("M\tsrc/foo.ts"),
            vec![diff("M", "src/foo.ts")]
        );
    }

    #[test]
    fn parse_diff_name_status_added_and_deleted() {
        assert_eq!(
            parse_diff_name_status("A\tsrc/new.ts\nD\tsrc/gone.ts"),
            vec![diff("A", "src/new.ts"), diff("D", "src/gone.ts")]
        );
    }

    #[test]
    fn parse_diff_name_status_renamed_with_old_path() {
        assert_eq!(
            parse_diff_name_status("R100\tsrc/old.ts\tsrc/new.ts"),
            vec![diff_renamed("R", "src/new.ts", "src/old.ts")]
        );
    }

    #[test]
    fn parse_diff_name_status_copied_with_old_path() {
        assert_eq!(
            parse_diff_name_status("C100\tsrc/original.ts\tsrc/copy.ts"),
            vec![diff_renamed("C", "src/copy.ts", "src/original.ts")]
        );
    }

    #[test]
    fn parse_diff_name_status_filters_empty_paths() {
        let result = parse_diff_name_status("M\tsrc/foo.ts\nM\t");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].path, "src/foo.ts");
    }

    #[test]
    fn parse_diff_name_status_empty() {
        assert_eq!(parse_diff_name_status(""), Vec::<DiffEntry>::new());
    }

    #[test]
    fn parse_diff_name_status_multiple() {
        let result = parse_diff_name_status("M\tsrc/foo.ts\nA\tsrc/bar.ts\nD\tsrc/baz.ts");
        assert_eq!(result.len(), 3);
        assert_eq!(result[0], diff("M", "src/foo.ts"));
        assert_eq!(result[1], diff("A", "src/bar.ts"));
        assert_eq!(result[2], diff("D", "src/baz.ts"));
    }

    // ---- parseStatusLines ----

    #[test]
    fn parse_status_lines_modified() {
        assert_eq!(
            parse_status_lines("M  src/foo.ts"),
            vec![diff("M", "src/foo.ts")]
        );
    }

    #[test]
    fn parse_status_lines_multiple_statuses() {
        let result = parse_status_lines("M  src/staged.ts\n M src/unstaged.ts\n?? src/new.ts");
        assert_eq!(result.len(), 3);
        assert_eq!(result[0], diff("M", "src/staged.ts"));
        assert_eq!(result[1], diff("M", "src/unstaged.ts"));
        assert_eq!(result[2], diff("??", "src/new.ts"));
    }

    #[test]
    fn parse_status_lines_renamed_arrow() {
        let result = parse_status_lines("R  src/old.ts -> src/new.ts");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], diff_renamed("R", "src/new.ts", "src/old.ts"));
    }

    #[test]
    fn parse_status_lines_copied_arrow() {
        let result = parse_status_lines("C  src/original.ts -> src/copy.ts");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            diff_renamed("C", "src/copy.ts", "src/original.ts")
        );
    }

    #[test]
    fn parse_status_lines_filters_directories() {
        let result = parse_status_lines("M  src/foo.ts\nA  src/dir/");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].path, "src/foo.ts");
    }

    #[test]
    fn parse_status_lines_empty() {
        assert_eq!(parse_status_lines(""), Vec::<DiffEntry>::new());
    }

    // ---- parseStatusBuckets ----

    #[test]
    fn parse_status_buckets_empty() {
        assert_eq!(
            parse_status_buckets(""),
            StatusBuckets {
                staged: vec![],
                unstaged: vec![],
                untracked: vec![]
            }
        );
    }

    #[test]
    fn parse_status_buckets_untracked() {
        assert_eq!(
            parse_status_buckets("?? src/new.ts"),
            StatusBuckets {
                staged: vec![],
                unstaged: vec![],
                untracked: vec!["src/new.ts".to_string()]
            }
        );
    }

    #[test]
    fn parse_status_buckets_staged_only() {
        let result = parse_status_buckets("M  src/staged.ts");
        assert!(result.staged.contains(&"src/staged.ts".to_string()));
        assert!(!result.unstaged.contains(&"src/staged.ts".to_string()));
        assert!(!result.untracked.contains(&"src/staged.ts".to_string()));
    }

    #[test]
    fn parse_status_buckets_working_only() {
        let result = parse_status_buckets(" M src/unstaged.ts");
        assert!(!result.staged.contains(&"src/unstaged.ts".to_string()));
        assert!(result.unstaged.contains(&"src/unstaged.ts".to_string()));
        assert!(!result.untracked.contains(&"src/unstaged.ts".to_string()));
    }

    #[test]
    fn parse_status_buckets_both() {
        let result = parse_status_buckets("MM src/both.ts");
        assert!(result.staged.contains(&"src/both.ts".to_string()));
        assert!(result.unstaged.contains(&"src/both.ts".to_string()));
        assert!(!result.untracked.contains(&"src/both.ts".to_string()));
    }

    #[test]
    fn parse_status_buckets_full() {
        assert_eq!(
            parse_status_buckets("M  src/staged.ts\n M src/unstaged.ts\n?? src/new.ts\n"),
            StatusBuckets {
                staged: vec!["src/staged.ts".to_string()],
                unstaged: vec!["src/unstaged.ts".to_string()],
                untracked: vec!["src/new.ts".to_string()],
            }
        );
    }

    // ---- parseBranchList ----

    #[test]
    fn parse_branch_list_current_marker() {
        assert_eq!(
            parse_branch_list("  feature\n* main\n"),
            BranchList {
                current: "main".to_string(),
                all: vec!["feature".to_string(), "main".to_string()]
            }
        );
    }

    #[test]
    fn parse_branch_list_detached_at() {
        assert_eq!(
            parse_branch_list("* (HEAD detached at 4be41bd)\n  feature\n  main\n"),
            BranchList {
                current: "4be41bd".to_string(),
                all: vec![
                    "4be41bd".to_string(),
                    "feature".to_string(),
                    "main".to_string()
                ]
            }
        );
    }

    #[test]
    fn parse_branch_list_detached_from() {
        let result = parse_branch_list("* (HEAD detached from origin/main)\n  main\n");
        assert_eq!(result.current, "origin/main");
        assert!(result.all.contains(&"origin/main".to_string()));
    }

    #[test]
    fn parse_branch_list_keeps_remotes_head_pseudo_ref() {
        assert_eq!(
            parse_branch_list(
                "  feature\n* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n"
            ),
            BranchList {
                current: "main".to_string(),
                all: vec![
                    "feature".to_string(),
                    "main".to_string(),
                    "remotes/origin/HEAD".to_string(),
                    "remotes/origin/main".to_string(),
                ],
            }
        );
    }

    #[test]
    fn parse_branch_list_empty_current_when_none_checked_out() {
        assert_eq!(
            parse_branch_list("  feature\n  main\n"),
            BranchList {
                current: String::new(),
                all: vec!["feature".to_string(), "main".to_string()]
            }
        );
    }

    #[test]
    fn parse_branch_list_empty() {
        assert_eq!(
            parse_branch_list(""),
            BranchList {
                current: String::new(),
                all: vec![]
            }
        );
    }

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
            parse_commit_hash(
                "[main (root-commit) 56a25fa0b22e6620abbc9cd6ba8aab04f94039fc] initial"
            ),
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
        let output =
            "Auto-merging src/a.ts\nAuto-merging src/b.ts\nMerge made by the 'ort' strategy.";
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

    #[test]
    fn parse_status_z_empty() {
        assert_eq!(
            parse_status_z(""),
            PorcelainStatus {
                conflicted: vec![],
                files: vec![]
            }
        );
    }

    #[test]
    fn parse_status_z_plain_modified() {
        assert_eq!(
            parse_status_z(" M src/foo.ts\0"),
            PorcelainStatus {
                conflicted: vec![],
                files: vec![status_file("src/foo.ts", " ", "M")],
            }
        );
    }

    #[test]
    fn parse_status_z_rename_consumes_source_token() {
        assert_eq!(
            parse_status_z("R  renamed.txt\0a.txt\0"),
            PorcelainStatus {
                conflicted: vec![],
                files: vec![status_file("renamed.txt", "R", " ")],
            }
        );
    }

    #[test]
    fn parse_status_z_uu_conflict() {
        assert_eq!(
            parse_status_z("UU f.txt\0"),
            PorcelainStatus {
                conflicted: vec!["f.txt".to_string()],
                files: vec![status_file("f.txt", "U", "U")],
            }
        );
    }

    #[test]
    fn parse_status_z_rename_and_conflict_together() {
        assert_eq!(
            parse_status_z("R  renamed.txt\0a.txt\0UU f.txt\0"),
            PorcelainStatus {
                conflicted: vec!["f.txt".to_string()],
                files: vec![
                    status_file("renamed.txt", "R", " "),
                    status_file("f.txt", "U", "U"),
                ],
            }
        );
    }

    #[test]
    fn parse_status_z_skips_ignored() {
        assert_eq!(
            parse_status_z("!! build/\0 M kept.ts\0"),
            PorcelainStatus {
                conflicted: vec![],
                files: vec![status_file("kept.ts", " ", "M")],
            }
        );
    }
}

// PORT STATUS: packages/core/src/git/git-parse.ts (203 lines)
// confidence: high
// notes: All porcelain parsers ported without a regex crate (not in the
// allowlist) — parseBranchList/parseCommitHash/parseDiffStatSummary use manual
// scanners that reproduce the exact regex semantics (verified against every
// ported fixture). `working_dir` stays snake_case (matches the TS field / simple-git
// shape); DiffEntry.oldPath uses camelCase + skip_serializing_if. is_not_git_repo
// takes a typed &GitExecError (the TS `unknown`/string/number third assertion is a
// dynamic-typing artifact, inexpressible in Rust — the two Error assertions are
// preserved). js_parse_int mirrors `parseInt(x,10)||0` for git-service's numeric
// fields. All 61 parser assertions ported byte-identically.
