//! Which tool calls count as "this chat may have created a worktree", and which
//! moved the session to another directory.
//!
//! A rescan offers every worktree that is new since the chat's last one, and
//! nothing ties a new worktree to the chat that made it. So a rescan must follow
//! a call that really creates one: a looser trigger (any command mentioning
//! "worktree", such as `git worktree list` or a `cd` into one) hands this chat
//! the worktrees other sessions created since its last scan.

use std::collections::HashMap;

/// Claude's `EnterWorktree`, or a shell call that runs `git worktree add`.
/// Neither result is parsed — the registry rescans git and decides for itself
/// what changed.
pub(super) fn creates_worktree(name: &str, input: &HashMap<String, serde_json::Value>) -> bool {
    if name == "EnterWorktree" {
        return true;
    }
    matches!(name, "Bash" | "BashTool")
        && input
            .get("command")
            .and_then(|value| value.as_str())
            .is_some_and(runs_git_worktree_add)
}

/// Claude's worktree tools change the session's working directory, and the CLI
/// moves the transcript with it (verified on 2.1.280, in both directions).
pub(super) fn moves_transcript(name: &str) -> bool {
    matches!(name, "EnterWorktree" | "ExitWorktree")
}

/// Whether any simple command in `command` is `git … worktree add`, allowing
/// git's global options (`-C <path>`, `-c k=v`) before the subcommand.
fn runs_git_worktree_add(command: &str) -> bool {
    command
        .split(['\n', ';', '&', '|', '(', ')'])
        .any(|segment| {
            let words: Vec<String> = segment
                .split_whitespace()
                .map(str::to_ascii_lowercase)
                .collect();
            words.iter().enumerate().any(|(i, word)| {
                (word == "git" || word.ends_with("/git"))
                    && words[i + 1..]
                        .windows(2)
                        .any(|pair| pair[0] == "worktree" && pair[1] == "add")
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bash(command: &str) -> HashMap<String, serde_json::Value> {
        HashMap::from([(
            "command".to_string(),
            serde_json::Value::String(command.to_string()),
        )])
    }

    #[test]
    fn git_worktree_add_counts_in_any_position_of_a_compound_command() {
        for command in [
            "git worktree add ../wt -b feat/x",
            "GIT WORKTREE ADD ../wt",
            "git -C /repo worktree add ../wt",
            "cd /repo && git worktree add .worktrees/x origin/main",
            "git fetch -q origin main; /usr/bin/git worktree add ../wt",
            "echo start\ngit worktree add ../wt",
        ] {
            assert!(creates_worktree("Bash", &bash(command)), "{command}");
        }
        assert!(creates_worktree(
            "BashTool",
            &bash("git worktree add ../wt")
        ));
    }

    #[test]
    fn worktree_commands_that_create_nothing_do_not_count() {
        for command in [
            "git worktree list",
            "git worktree remove ../wt",
            "git worktree prune",
            "cd /repo/.worktrees/fix-x && cargo test",
            "ls .worktrees && echo add",
            "grep -rn 'worktree add' docs",
        ] {
            assert!(!creates_worktree("Bash", &bash(command)), "{command}");
        }
    }

    #[test]
    fn enter_worktree_creates_and_both_worktree_tools_move_the_transcript() {
        assert!(creates_worktree("EnterWorktree", &HashMap::new()));
        assert!(!creates_worktree("ExitWorktree", &HashMap::new()));
        assert!(moves_transcript("EnterWorktree"));
        assert!(moves_transcript("ExitWorktree"));
        assert!(!moves_transcript("Bash"));
    }
}
