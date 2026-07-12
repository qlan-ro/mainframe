//! Ported from `packages/core/src/plugins/builtin/codex/external-session-parse.ts`.
//!
//! Parsing for Codex rollout JSONL heads: session_meta facts and the first real
//! user prompt. Kept separate from the filesystem scan so both stay small.
//!
//! The three JS regexes (`CWD_RE`, and the two `cleanPrompt` tag-strippers) are
//! hand-rolled here — the port has no `regex` crate on the dependency allowlist,
//! so each is reproduced as an explicit scanner with the same leftmost/global
//! `String.replace(/…/g)` semantics.

use serde::Deserialize;

// Codex's first user message bundles injected context blocks (plugins, AGENTS.md,
// environment) before the user's real prompt; each block is a separate
// `input_text`, so we skip blocks that begin with these markers.
const PREAMBLE_PREFIXES: &[&str] = &[
    "<recommended_plugins>",
    "<environment_context>",
    "<user_instructions>",
    "<INSTRUCTIONS>",
    "# AGENTS.md instructions",
    "# Context from my IDE setup",
];

/// Project-independent facts from a rollout's session_meta.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RolloutMeta {
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitInfo {
    #[serde(default)]
    branch: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RolloutPayload {
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    git: Option<GitInfo>,
    #[serde(default)]
    content: Option<Vec<ContentBlock>>,
}

#[derive(Debug, Clone, Deserialize)]
struct ContentBlock {
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RolloutLine {
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    payload: Option<RolloutPayload>,
}

pub fn parse_lines(chunk: &str) -> Vec<RolloutLine> {
    let mut out = Vec::new();
    for line in chunk.split('\n') {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        // Truncated line at the head-byte boundary is expected — skip on parse error.
        if let Ok(parsed) = serde_json::from_str::<RolloutLine>(t) {
            out.push(parsed);
        }
    }
    out
}

/// Each user message holds one or more `input_text` blocks; return them in order.
fn user_text_blocks(line: &RolloutLine) -> Vec<String> {
    if line.kind.as_deref() != Some("response_item") {
        return Vec::new();
    }
    let Some(p) = &line.payload else {
        return Vec::new();
    };
    if p.kind.as_deref() != Some("message") || p.role.as_deref() != Some("user") {
        return Vec::new();
    }
    let Some(content) = &p.content else {
        return Vec::new();
    };
    content
        .iter()
        .filter(|c| matches!(c.kind.as_deref(), Some("input_text") | Some("text")))
        .map(|c| c.text.clone().unwrap_or_default())
        .collect()
}

fn is_preamble(text: &str) -> bool {
    let t = text.trim_start();
    PREAMBLE_PREFIXES.iter().any(|prefix| t.starts_with(prefix))
        || t.chars()
            .take(200)
            .collect::<String>()
            .contains("<INSTRUCTIONS>")
}

/// Remove `<tag>…</tag>` pairs (`/<[^>]+>[^<]*<\/[^>]+>/g`) then any remaining
/// `<…>` tags (`/<[^>]+>/g`), collapse whitespace runs (`/\s+/g` → ' '), and trim.
fn clean_prompt(text: &str) -> String {
    let stage1 = strip_tag_pairs(text);
    let stage2 = strip_tags(&stage1);
    collapse_whitespace(&stage2).trim().to_string()
}

/// `/<[^>]+>[^<]*<\/[^>]+>/g` — an open tag `<…>` (≥1 non-`>`), then `[^<]*`, then a
/// close tag `</…>` (≥1 non-`>`). Leftmost, non-overlapping, global.
fn strip_tag_pairs(s: &str) -> String {
    let b: Vec<char> = s.chars().collect();
    let n = b.len();
    let mut out = String::new();
    let mut i = 0;
    while i < n {
        if b[i] == '<'
            && let Some(end) = match_tag_pair(&b, i)
        {
            i = end;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    out
}

/// Returns the index just past a `<…>[^<]*</…>` match starting at `i`, else `None`.
fn match_tag_pair(b: &[char], i: usize) -> Option<usize> {
    let n = b.len();
    // open tag: '<' then one+ non-'>' then '>'
    let open_end = scan_tag(b, i)?; // index just past '>'
    // [^<]*
    let mut k = open_end;
    while k < n && b[k] != '<' {
        k += 1;
    }
    // close tag: '<' '/' one+ non-'>' '>'
    if k + 1 >= n || b[k] != '<' || b[k + 1] != '/' {
        return None;
    }
    // content between '/' and '>' must be one+ non-'>'
    let mut m = k + 2;
    if m >= n || b[m] == '>' {
        return None;
    }
    while m < n && b[m] != '>' {
        m += 1;
    }
    if m >= n {
        return None;
    }
    Some(m + 1)
}

/// `/<[^>]+>/g` — a `<` then one+ non-`>` then `>`.
fn strip_tags(s: &str) -> String {
    let b: Vec<char> = s.chars().collect();
    let n = b.len();
    let mut out = String::new();
    let mut i = 0;
    while i < n {
        if b[i] == '<'
            && let Some(end) = scan_tag(&b, i)
        {
            i = end;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    out
}

/// From a `<` at `i`, match `<` `[^>]+` `>` and return the index just past `>`.
fn scan_tag(b: &[char], i: usize) -> Option<usize> {
    let n = b.len();
    if i >= n || b[i] != '<' {
        return None;
    }
    let mut j = i + 1;
    if j >= n || b[j] == '>' {
        return None; // `[^>]+` requires at least one char
    }
    while j < n && b[j] != '>' {
        j += 1;
    }
    if j >= n {
        return None;
    }
    Some(j + 1)
}

/// `/\s+/g` → ' '.
fn collapse_whitespace(s: &str) -> String {
    let mut out = String::new();
    let mut in_ws = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !in_ws {
                out.push(' ');
                in_ws = true;
            }
        } else {
            out.push(c);
            in_ws = false;
        }
    }
    out
}

/// First block, across all user messages, that isn't injected context.
pub fn first_user_prompt(lines: &[RolloutLine]) -> Option<String> {
    for line in lines {
        for text in user_text_blocks(line) {
            if text.is_empty() || is_preamble(&text) {
                continue;
            }
            let cleaned = clean_prompt(&text);
            if !cleaned.is_empty() {
                return Some(cleaned.chars().take(500).collect());
            }
        }
    }
    None
}

pub fn extract_meta(lines: &[RolloutLine], head: &str) -> RolloutMeta {
    let meta = lines
        .iter()
        .find(|l| l.kind.as_deref() == Some("session_meta"))
        .and_then(|l| l.payload.as_ref());
    // Regex fallback covers a session_meta line truncated past the read window; cwd
    // is an early field so the first match is always the real one.
    let cwd = meta.and_then(|m| m.cwd.clone()).or_else(|| cwd_regex(head));
    let git_branch = meta
        .and_then(|m| m.git.as_ref())
        .and_then(|g| g.branch.clone())
        .filter(|b| !b.is_empty());
    let created_at = meta.and_then(|m| m.timestamp.clone());
    RolloutMeta {
        cwd,
        git_branch,
        created_at,
    }
}

/// `/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/` — the first `"cwd": "…"` value, returned raw
/// (escape sequences left intact, as the JS capture group is).
fn cwd_regex(head: &str) -> Option<String> {
    let b: Vec<char> = head.chars().collect();
    let n = b.len();
    let needle: Vec<char> = "\"cwd\"".chars().collect();
    let mut i = 0;
    while i + needle.len() <= n {
        if b[i..i + needle.len()] == needle[..] {
            let mut k = i + needle.len();
            while k < n && b[k].is_whitespace() {
                k += 1;
            }
            if k < n && b[k] == ':' {
                k += 1;
                while k < n && b[k].is_whitespace() {
                    k += 1;
                }
                if k < n && b[k] == '"' {
                    k += 1;
                    let mut val = String::new();
                    while k < n {
                        let c = b[k];
                        if c == '\\' {
                            // `\\.` — backslash plus any one char, both captured raw.
                            if k + 1 < n {
                                val.push(c);
                                val.push(b[k + 1]);
                                k += 2;
                                continue;
                            }
                            break;
                        }
                        if c == '"' {
                            return Some(val);
                        }
                        val.push(c);
                        k += 1;
                    }
                    // Unterminated: no closing quote — no match here, keep scanning.
                }
            }
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_tag_pairs_removes_image_block() {
        assert_eq!(
            clean_prompt("<image name=[Image #1]></image>Add a dark mode toggle to settings"),
            "Add a dark mode toggle to settings"
        );
    }

    #[test]
    fn cwd_regex_extracts_first_value() {
        assert_eq!(
            cwd_regex(r#"{"payload":{"cwd":"/Users/dev/app","x":1}}"#).as_deref(),
            Some("/Users/dev/app")
        );
    }
}

// PORT STATUS: src/plugins/builtin/codex/external-session-parse.ts (91 lines)
// confidence: high
// todos: 0
// notes: NEW (#430). RolloutLine/payload/content deserialize with serde (unknown
// notes: fields tolerated). The three JS regexes are hand-rolled scanners (no `regex`
// notes: crate on the allowlist): strip_tag_pairs = /<[^>]+>[^<]*<\/[^>]+>/g,
// notes: strip_tags = /<[^>]+>/g, collapse_whitespace = /\s+/g→' ', cwd_regex =
// notes: /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/ (raw capture, escapes intact). is_preamble
// notes: mirrors the prefix list + first-200-char <INSTRUCTIONS> probe. extract_meta's
// notes: git branch `|| undefined` maps to filter(non-empty).
