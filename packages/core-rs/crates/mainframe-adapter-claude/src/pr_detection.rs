//! Ported from `packages/core/src/plugins/builtin/claude/pr-detection.ts`.
//!
//! The TS module leans on JS regexes; the Rust workspace has no `regex` crate in
//! the allowlist (mirroring `mainframe-adapter-api::parse_version`), so every
//! pattern here is hand-rolled. The pure-function tests port assertion-for-
//! assertion; the `.test()` boolean checks map to `parse_*(...).is_some()`.

use mainframe_types::adapter::DetectedPr;

/// PR info without the `source` field — used as the value shape for stashed
/// mutations and as the parser return type. (`Omit<DetectedPr, 'source'>`.)
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPrCore {
    pub url: String,
    pub owner: String,
    pub repo: String,
    pub number: i64,
}

impl DetectedPrCore {
    /// Rebuild the full `DetectedPr` (`{ ...core, source }`) — the events layer
    /// stamps `source` when emitting `onPrDetected`.
    pub fn with_source(self, source: mainframe_types::adapter::DetectedPrSource) -> DetectedPr {
        DetectedPr {
            url: self.url,
            owner: self.owner,
            repo: self.repo,
            number: self.number,
            source,
        }
    }
}

// ---------------------------------------------------------------------------
// hand-rolled scanning primitives (no `regex` crate — §8 allowlist)
// ---------------------------------------------------------------------------

/// `\w` — the ASCII word-char class (`[A-Za-z0-9_]`).
fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// `\b` — a word boundary sits at `pos` when exactly one side is a word char.
fn boundary_at(chars: &[char], pos: usize) -> bool {
    let before = pos > 0 && is_word_char(chars[pos - 1]);
    let after = pos < chars.len() && is_word_char(chars[pos]);
    before != after
}

/// `([^/\s]+)` — read one-or-more non-slash, non-whitespace chars; returns the
/// segment and the remaining suffix, or `None` when empty.
fn read_segment(s: &str) -> Option<(&str, &str)> {
    let end = s
        .find(|c: char| c == '/' || c.is_whitespace())
        .unwrap_or(s.len());
    if end == 0 {
        return None;
    }
    Some((&s[..end], &s[end..]))
}

/// `(\d+)` — read one-or-more ASCII digits; returns the digit run and the suffix.
fn read_digits(s: &str) -> Option<(&str, &str)> {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    if end == 0 {
        return None;
    }
    Some((&s[..end], &s[end..]))
}

/// `\b w0 \s+ w1 \s+ ... wN \b` — the whole word-sequence bounded on both ends.
fn has_word_sequence(hay: &str, words: &[&str]) -> bool {
    match_word_sequence(hay, words, TrailingBoundary::WordBoundary)
}

/// `\b w0 \s+ w1 \s+ ... wN \s+` — same, but requiring trailing whitespace
/// instead of a bare boundary (the `/\bgh\s+pr\s+/` prefix probe).
fn has_word_sequence_trailing_ws(hay: &str, words: &[&str]) -> bool {
    match_word_sequence(hay, words, TrailingBoundary::RequireWhitespace)
}

enum TrailingBoundary {
    WordBoundary,
    RequireWhitespace,
}

fn match_word_sequence(hay: &str, words: &[&str], trailing: TrailingBoundary) -> bool {
    if words.is_empty() {
        return false;
    }
    let chars: Vec<char> = hay.chars().collect();
    let n = chars.len();
    'outer: for start in 0..=n {
        // `\b` before the first (word-char-initial) token: prev must be non-word.
        if start > 0 && is_word_char(chars[start - 1]) {
            continue;
        }
        let mut i = start;
        for (wi, w) in words.iter().enumerate() {
            if wi > 0 {
                // `\s+` between tokens — at least one whitespace char.
                let ws_start = i;
                while i < n && chars[i].is_whitespace() {
                    i += 1;
                }
                if i == ws_start {
                    continue 'outer;
                }
            }
            for wc in w.chars() {
                if i >= n || chars[i] != wc {
                    continue 'outer;
                }
                i += 1;
            }
        }
        match trailing {
            TrailingBoundary::WordBoundary => {
                if i < n && is_word_char(chars[i]) {
                    continue;
                }
            }
            TrailingBoundary::RequireWhitespace => {
                if i >= n || !chars[i].is_whitespace() {
                    continue;
                }
            }
        }
        return true;
    }
    false
}

// ---------------------------------------------------------------------------
// URL / command patterns
// ---------------------------------------------------------------------------

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

fn try_github(rest: &str) -> Option<DetectedPrCore> {
    let prefix = "https://github.com/";
    let (owner, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let (repo, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let rest = rest.strip_prefix("pull")?;
    let rest = rest.strip_prefix('/')?;
    let (digits, _) = read_digits(rest)?;
    Some(DetectedPrCore {
        url: format!("{prefix}{owner}/{repo}/pull/{digits}"),
        owner: owner.to_string(),
        repo: repo.to_string(),
        number: digits.parse().ok()?,
    })
}

/// `https://github.com/([^/\s]+)/([^/\s]+)/pull/(\d+)`
pub fn parse_pr_url(text: &str) -> Option<DetectedPrCore> {
    scan_prefix(text, "https://github.com/", try_github)
}

fn try_gitlab(rest: &str) -> Option<DetectedPrCore> {
    let prefix = "https://gitlab.com/";
    let (owner, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let (repo, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let rest = rest.strip_prefix('-')?;
    let rest = rest.strip_prefix('/')?;
    let rest = rest.strip_prefix("merge_requests")?;
    let rest = rest.strip_prefix('/')?;
    let (digits, _) = read_digits(rest)?;
    Some(DetectedPrCore {
        url: format!("{prefix}{owner}/{repo}/-/merge_requests/{digits}"),
        owner: owner.to_string(),
        repo: repo.to_string(),
        number: digits.parse().ok()?,
    })
}

/// `https://gitlab.com/([^/\s]+)/([^/\s]+)/-/merge_requests/(\d+)`
pub fn parse_gitlab_mr_url(text: &str) -> Option<DetectedPrCore> {
    scan_prefix(text, "https://gitlab.com/", try_gitlab)
}

fn try_azure(rest: &str) -> Option<DetectedPrCore> {
    let prefix = "https://dev.azure.com/";
    let (owner, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let (project, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let rest = rest.strip_prefix("_git")?;
    let rest = rest.strip_prefix('/')?;
    let (repo, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let rest = rest.strip_prefix("pullrequest")?;
    let rest = rest.strip_prefix('/')?;
    let (digits, _) = read_digits(rest)?;
    Some(DetectedPrCore {
        url: format!("{prefix}{owner}/{project}/_git/{repo}/pullrequest/{digits}"),
        owner: owner.to_string(),
        repo: repo.to_string(),
        number: digits.parse().ok()?,
    })
}

/// `https://dev.azure.com/([^/\s]+)/[^/\s]+/_git/([^/\s]+)/pullrequest/(\d+)`
pub fn parse_azure_pr_url(text: &str) -> Option<DetectedPrCore> {
    scan_prefix(text, "https://dev.azure.com/", try_azure)
}

/// Try to match `f` at each occurrence of `prefix` in `text` (regex left-to-right
/// scan); return the first full match.
fn scan_prefix(
    text: &str,
    prefix: &str,
    f: impl Fn(&str) -> Option<DetectedPrCore>,
) -> Option<DetectedPrCore> {
    let mut from = 0;
    while let Some(rel) = text[from..].find(prefix) {
        let occ = from + rel;
        if let Some(pr) = f(&text[occ + prefix.len()..]) {
            return Some(pr);
        }
        from = occ + 1;
    }
    None
}

/// `"pullRequestId"\s*:\s*(\d+)` + `"name"\s*:\s*"([^"]+)"` + `dev\.azure\.com/([^/"]+)`.
fn parse_azure_pr_json(text: &str) -> Option<DetectedPrCore> {
    let number = json_number_after(text, "\"pullRequestId\"")?;
    let repo = json_string_after(text, "\"name\"").unwrap_or_else(|| "unknown".to_string());
    let owner = azure_org(text).unwrap_or_else(|| "azure".to_string());
    Some(DetectedPrCore {
        url: text.trim().to_string(),
        owner,
        repo,
        number,
    })
}

fn json_number_after(text: &str, key: &str) -> Option<i64> {
    let idx = text.find(key)?;
    let rest = text[idx + key.len()..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    let (digits, _) = read_digits(rest)?;
    digits.parse().ok()
}

fn json_string_after(text: &str, key: &str) -> Option<String> {
    let idx = text.find(key)?;
    let rest = text[idx + key.len()..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    if end == 0 {
        return None;
    }
    Some(rest[..end].to_string())
}

fn azure_org(text: &str) -> Option<String> {
    let marker = "dev.azure.com/";
    let idx = text.find(marker)?;
    let rest = &text[idx + marker.len()..];
    let end = rest.find(['/', '"']).unwrap_or(rest.len());
    if end == 0 {
        return None;
    }
    Some(rest[..end].to_string())
}

/// `parsePrUrl ?? parseGitlabMrUrl ?? parseAzurePrUrl ?? parseAzurePrJson`.
pub fn extract_pr_from_tool_result(text: &str) -> Option<DetectedPrCore> {
    parse_pr_url(text)
        .or_else(|| parse_gitlab_mr_url(text))
        .or_else(|| parse_azure_pr_url(text))
        .or_else(|| parse_azure_pr_json(text))
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

// PORT STATUS: src/plugins/builtin/claude/pr-detection.ts (127 lines)
// confidence: high
// todos: 0
// notes: all JS regexes hand-rolled (no `regex` crate in the §8 allowlist), matching
// notes: mainframe-adapter-api::parse_version's approach. `DetectedPrCore` =
// notes: Omit<DetectedPr,'source'>. Pure-function tests ported assertion-for-assertion
// notes: from pr-detection.test.ts + pr-mutation-detection.test.ts; the `handleStdout`
// notes: integration blocks in those files belong to events.rs/user_event.rs (blocked
// notes: on the session cluster) and are NOT ported here.
