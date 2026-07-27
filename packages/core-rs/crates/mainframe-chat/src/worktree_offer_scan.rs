//! Pure eligibility scan turning a git worktree listing into offer candidates.
//!
//! Paths are compared verbatim — no IO, no locks, no clock. The registry
//! canonicalizes every path source before it builds `ScanInputs`, so a path that
//! reaches here has already been resolved (A10).

use std::collections::{BTreeSet, HashSet};

use mainframe_services::workspace::{WorktreeEntry, short_branch};

pub struct ScanInputs<'a> {
    /// The project's main checkout — registered, but never an offer.
    pub main_worktree_path: &'a str,
    /// Worktrees the previous scan saw (the chat's activation listing until then);
    /// anything here is old news.
    pub baseline: &'a HashSet<String>,
    /// `git worktree list` as it stands now; empty when the git call failed.
    pub current: &'a [WorktreeEntry],
    pub chat_worktree_path: Option<&'a str>,
    pub dismissed: &'a HashSet<String>,
    pub other_chat_worktrees: &'a HashSet<String>,
    pub pending: &'a BTreeSet<String>,
}

pub struct ScanOutcome {
    /// `(worktree path, short branch name)` per candidate, in listing order.
    pub raise: Vec<(String, Option<String>)>,
    /// Pending offers whose worktree is gone.
    pub expire: Vec<String>,
}

pub fn scan(inputs: ScanInputs<'_>) -> ScanOutcome {
    let raise = inputs
        .current
        .iter()
        .filter(|entry| is_eligible(&inputs, &entry.path))
        .map(|entry| {
            let branch = entry.branch.as_deref().map(|b| short_branch(b).to_string());
            (entry.path.clone(), branch)
        })
        .collect();

    let live: HashSet<&str> = inputs.current.iter().map(|e| e.path.as_str()).collect();
    let expire = inputs
        .pending
        .iter()
        .filter(|path| !live.contains(path.as_str()))
        .cloned()
        .collect();

    ScanOutcome { raise, expire }
}

/// The five gates a registered worktree clears before it is worth offering.
fn is_eligible(inputs: &ScanInputs<'_>, path: &str) -> bool {
    path != inputs.main_worktree_path
        && !inputs.baseline.contains(path)
        && inputs.chat_worktree_path != Some(path)
        && !inputs.dismissed.contains(path)
        && !inputs.other_chat_worktrees.contains(path)
        && !inputs.pending.contains(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_services::workspace::WorktreeEntry;
    use std::collections::{BTreeSet, HashSet};

    fn entry(path: &str, branch: Option<&str>) -> WorktreeEntry {
        WorktreeEntry {
            path: path.to_string(),
            branch: branch.map(str::to_string),
        }
    }

    fn set(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    fn pending_set(paths: &[&str]) -> BTreeSet<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    fn raised(path: &str, branch: Option<&str>) -> (String, Option<String>) {
        (path.to_string(), branch.map(str::to_string))
    }

    fn no_raise() -> Vec<(String, Option<String>)> {
        Vec::new()
    }

    fn no_expire() -> Vec<String> {
        Vec::new()
    }

    /// Owns the borrowed inputs so each test can set only the fields it cares about.
    struct Fixture {
        main: String,
        baseline: HashSet<String>,
        current: Vec<WorktreeEntry>,
        chat: Option<String>,
        dismissed: HashSet<String>,
        others: HashSet<String>,
        pending: BTreeSet<String>,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                main: "/repo".to_string(),
                baseline: HashSet::new(),
                current: Vec::new(),
                chat: None,
                dismissed: HashSet::new(),
                others: HashSet::new(),
                pending: BTreeSet::new(),
            }
        }

        fn inputs(&self) -> ScanInputs<'_> {
            ScanInputs {
                main_worktree_path: &self.main,
                baseline: &self.baseline,
                current: &self.current,
                chat_worktree_path: self.chat.as_deref(),
                dismissed: &self.dismissed,
                other_chat_worktrees: &self.others,
                pending: &self.pending,
            }
        }
    }

    #[test]
    fn raises_a_worktree_new_since_the_baseline_carrying_its_short_branch_name() {
        let mut f = Fixture::new();
        f.baseline = set(&["/repo"]);
        f.current = vec![
            entry("/repo", Some("refs/heads/main")),
            entry("/repo/.worktrees/x", Some("refs/heads/feat/x")),
        ];

        let out = scan(f.inputs());

        assert_eq!(
            out.raise,
            vec![raised("/repo/.worktrees/x", Some("feat/x"))]
        );
        assert_eq!(out.expire, no_expire());
        assert!(
            !out.raise[0]
                .1
                .as_deref()
                .unwrap()
                .starts_with("refs/heads/")
        );
    }

    #[test]
    fn raises_a_detached_worktree_with_no_branch_name() {
        let mut f = Fixture::new();
        f.baseline = set(&["/repo"]);
        f.current = vec![
            entry("/repo", Some("refs/heads/main")),
            entry("/repo/.worktrees/detached", None),
        ];

        let out = scan(f.inputs());

        assert_eq!(out.raise, vec![raised("/repo/.worktrees/detached", None)]);
        assert_eq!(out.expire, no_expire());
    }

    #[test]
    fn never_raises_the_main_worktree_path_even_when_it_is_absent_from_the_baseline() {
        let mut f = Fixture::new();
        f.current = vec![
            entry("/repo", Some("refs/heads/main")),
            entry("/repo/.worktrees/x", Some("refs/heads/feat/x")),
        ];

        let out = scan(f.inputs());

        assert_eq!(
            out.raise,
            vec![raised("/repo/.worktrees/x", Some("feat/x"))]
        );
        assert_eq!(out.expire, no_expire());
    }

    #[test]
    fn never_raises_the_chats_own_current_worktree_binding() {
        let mut f = Fixture::new();
        f.baseline = set(&["/repo"]);
        f.chat = Some("/repo/.worktrees/mine".to_string());
        f.current = vec![
            entry("/repo", Some("refs/heads/main")),
            entry("/repo/.worktrees/mine", Some("refs/heads/feat/mine")),
            entry("/repo/.worktrees/other", Some("refs/heads/feat/other")),
        ];

        let out = scan(f.inputs());

        assert_eq!(
            out.raise,
            vec![raised("/repo/.worktrees/other", Some("feat/other"))]
        );
        assert_eq!(out.expire, no_expire());
    }

    #[test]
    fn does_not_raise_a_path_that_is_already_pending() {
        let mut f = Fixture::new();
        f.baseline = set(&["/repo"]);
        f.pending = pending_set(&["/repo/.worktrees/x"]);
        f.current = vec![
            entry("/repo", Some("refs/heads/main")),
            entry("/repo/.worktrees/x", Some("refs/heads/feat/x")),
            entry("/repo/.worktrees/y", Some("refs/heads/feat/y")),
        ];

        let out = scan(f.inputs());

        assert_eq!(
            out.raise,
            vec![raised("/repo/.worktrees/y", Some("feat/y"))]
        );
        assert_eq!(out.expire, no_expire());
    }

    #[test]
    fn never_raises_a_dismissed_path() {
        let mut f = Fixture::new();
        f.baseline = set(&["/repo"]);
        f.dismissed = set(&["/repo/.worktrees/nope"]);
        f.current = vec![
            entry("/repo", Some("refs/heads/main")),
            entry("/repo/.worktrees/nope", Some("refs/heads/feat/nope")),
        ];

        let out = scan(f.inputs());

        assert_eq!(out.raise, no_raise());
        assert_eq!(out.expire, no_expire());
    }

    #[test]
    fn never_raises_a_path_that_is_another_chats_worktree_binding() {
        let mut f = Fixture::new();
        f.baseline = set(&["/repo"]);
        f.others = set(&["/repo/.worktrees/taken"]);
        f.current = vec![
            entry("/repo", Some("refs/heads/main")),
            entry("/repo/.worktrees/taken", Some("refs/heads/feat/taken")),
        ];

        let out = scan(f.inputs());

        assert_eq!(out.raise, no_raise());
        assert_eq!(out.expire, no_expire());
    }

    #[test]
    fn never_raises_a_baseline_path_when_it_reappears_in_current_unchanged() {
        let mut f = Fixture::new();
        f.baseline = set(&["/repo", "/repo/.worktrees/old"]);
        f.current = vec![
            entry("/repo", Some("refs/heads/main")),
            entry("/repo/.worktrees/old", Some("refs/heads/feat/old")),
            entry("/repo/.worktrees/new", Some("refs/heads/feat/new")),
        ];

        let out = scan(f.inputs());

        assert_eq!(
            out.raise,
            vec![raised("/repo/.worktrees/new", Some("feat/new"))]
        );
        assert_eq!(out.expire, no_expire());
    }

    #[test]
    fn expires_only_the_pending_paths_that_are_gone_from_the_current_list() {
        let mut f = Fixture::new();
        f.baseline = set(&["/repo", "/repo/.worktrees/still"]);
        f.pending = pending_set(&["/repo/.worktrees/gone", "/repo/.worktrees/still"]);
        f.current = vec![
            entry("/repo", Some("refs/heads/main")),
            entry("/repo/.worktrees/still", Some("refs/heads/feat/still")),
        ];

        let out = scan(f.inputs());

        assert_eq!(out.raise, no_raise());
        assert_eq!(out.expire, vec!["/repo/.worktrees/gone".to_string()]);
    }

    #[test]
    fn raises_nothing_and_expires_everything_pending_when_git_fails_and_current_is_empty() {
        let mut f = Fixture::new();
        f.baseline = set(&["/repo"]);
        f.pending = pending_set(&["/repo/.worktrees/a", "/repo/.worktrees/b"]);

        let out = scan(f.inputs());

        assert_eq!(out.raise, no_raise());
        assert_eq!(
            out.expire,
            vec![
                "/repo/.worktrees/a".to_string(),
                "/repo/.worktrees/b".to_string()
            ]
        );
    }

    #[test]
    fn compares_paths_verbatim_so_an_uncanonicalized_chat_binding_still_raises_the_candidate() {
        // Contract, not a bug: canonicalization belongs to the registry (A10).
        let mut f = Fixture::new();
        f.baseline = set(&["/repo"]);
        f.chat = Some("/tmp/wt/x".to_string());
        f.current = vec![
            entry("/repo", Some("refs/heads/main")),
            entry("/private/tmp/wt/x", Some("refs/heads/feat/x")),
        ];

        let out = scan(f.inputs());

        assert_eq!(out.raise, vec![raised("/private/tmp/wt/x", Some("feat/x"))]);
        assert_eq!(out.expire, no_expire());
    }
}
