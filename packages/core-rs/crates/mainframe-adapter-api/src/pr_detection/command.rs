//! Command-text classification: PR-create / PR-mutation recognition and the
//! live-scan tool gate.

use super::DetectedPrCore;
use super::parse::extract_pr_from_tool_result;
use super::text::{boundary_at, has_word_sequence, has_word_sequence_trailing_ws};

/// `\bgh\s+pr\s+create\b` etc.
pub fn is_pr_create_command(command: &str) -> bool {
    has_word_sequence(command, &["gh", "pr", "create"])
        || has_word_sequence(command, &["glab", "mr", "create"])
        || has_word_sequence(command, &["az", "repos", "pr", "create"])
}

/// `\bgh\s+pr\s+(edit|ready|merge|close|reopen|comment|review)\b` etc.
pub fn is_pr_mutation_command(command: &str) -> bool {
    for verb in [
        "edit", "ready", "merge", "close", "reopen", "comment", "review",
    ] {
        if has_word_sequence(command, &["gh", "pr", verb]) {
            return true;
        }
    }
    for verb in ["update", "merge", "close", "reopen", "note"] {
        if has_word_sequence(command, &["glab", "mr", verb]) {
            return true;
        }
    }
    has_word_sequence(command, &["az", "repos", "pr", "update"])
}

/// `\b(gh\s+pr|glab\s+mr|az\s+repos\s+pr)\b`
fn pr_relevant_bash(command: &str) -> bool {
    has_word_sequence(command, &["gh", "pr"])
        || has_word_sequence(command, &["glab", "mr"])
        || has_word_sequence(command, &["az", "repos", "pr"])
}

/// The originating tool_use metadata Path-A PR scanning consults.
pub struct ToolUseMeta<'a> {
    pub name: &'a str,
    pub command: Option<&'a str>,
}

/// Tools whose tool_result we trust to surface PR URLs that belong to this chat.
pub fn should_scan_tool_result_for_pr(meta: Option<&ToolUseMeta>) -> bool {
    let Some(meta) = meta else {
        return false;
    };
    if meta.name == "Bash" || meta.name == "BashTool" {
        return meta.command.map(pr_relevant_bash).unwrap_or(false);
    }
    meta.name == "Agent" || meta.name == "Task"
}

/// `\b([^/\s#]+)/([^/\s#]+)#(\d+)\b` — the gh-only compact `owner/repo#N` ref.
fn gh_compact_ref(hay: &str) -> Option<(String, String, i64)> {
    let chars: Vec<char> = hay.chars().collect();
    let n = chars.len();
    let is_sep = |c: char| c == '/' || c == '#' || c.is_whitespace();
    for start in 0..n {
        if !boundary_at(&chars, start) {
            continue;
        }
        let mut i = start;
        let os = i;
        while i < n && !is_sep(chars[i]) {
            i += 1;
        }
        if i == os || i >= n || chars[i] != '/' {
            continue;
        }
        let owner: String = chars[os..i].iter().collect();
        i += 1;
        let rs = i;
        while i < n && !is_sep(chars[i]) {
            i += 1;
        }
        if i == rs || i >= n || chars[i] != '#' {
            continue;
        }
        let repo: String = chars[rs..i].iter().collect();
        i += 1;
        let ds = i;
        while i < n && chars[i].is_ascii_digit() {
            i += 1;
        }
        if i == ds || !boundary_at(&chars, i) {
            continue;
        }
        let digits: String = chars[ds..i].iter().collect();
        if let Ok(number) = digits.parse::<i64>() {
            return Some((owner, repo, number));
        }
    }
    None
}

/// Resolve a PR identifier from a mutation command's args: a full URL first, then
/// gh-only compact `owner/repo#N`.
pub fn parse_pr_identifier_from_args(command: &str) -> Option<DetectedPrCore> {
    if let Some(from_url) = extract_pr_from_tool_result(command) {
        return Some(from_url);
    }
    // `/\bgh\s+pr\s+/` gate — compact syntax is gh-only.
    if has_word_sequence_trailing_ws(command, &["gh", "pr"])
        && let Some((owner, repo, number)) = gh_compact_ref(command)
        && !owner.is_empty()
        && !repo.is_empty()
    {
        return Some(DetectedPrCore {
            url: format!("https://github.com/{owner}/{repo}/pull/{number}"),
            owner,
            repo,
            number,
        });
    }
    None
}
