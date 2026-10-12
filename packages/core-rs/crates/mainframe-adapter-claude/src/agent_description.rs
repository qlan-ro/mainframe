//! Derives an agent's picker-row description from its frontmatter.
//!
//! Two file kinds used to have two derivations: skills read
//! `attributes["description"]`, agents took the first markdown line — which,
//! for a fenced agent file, is the opening `---`. This module is the single
//! derivation both should have used: read the frontmatter `description` when
//! the file declares one, and fall back to the pre-existing heading heuristic
//! only when it doesn't.

use std::collections::HashSet;

use crate::frontmatter::parse_frontmatter;

/// The picker caption plus the complete declared value, when there is one.
pub struct AgentDescription {
    /// One-line caption for the picker row.
    pub summary: String,
    /// The complete declared frontmatter description, when the file declares one.
    pub full: Option<String>,
}

/// Reads the frontmatter `description` when the file declares a non-empty one
/// and summarizes it; otherwise falls back to the heading heuristic applied to
/// the parsed body (never the raw file — a fenced-but-descriptionless agent
/// would otherwise caption `---`).
pub(crate) fn derive_agent_description(raw: &str) -> AgentDescription {
    let fm = parse_frontmatter(raw);
    let full = fm
        .attributes
        .get("description")
        .filter(|value| !value.trim().is_empty())
        .cloned();

    let summary = match &full {
        Some(value) => summarize(value),
        None => heading_heuristic(&fm.body),
    };

    AgentDescription { summary, full }
}

/// The heading heuristic: first non-blank line, leading `#`s stripped.
fn heading_heuristic(body: &str) -> String {
    let first_line = body
        .split('\n')
        .find(|l| !l.trim().is_empty())
        .unwrap_or("");
    if first_line.starts_with('#') {
        first_line.trim_start_matches('#').trim_start().to_string()
    } else {
        first_line.to_string()
    }
}

/// Projects a declared description to a one-line picker caption: the first
/// caption line, cut at the first sentence boundary, capped at 200 characters.
fn summarize(full: &str) -> String {
    let line = first_caption_line(full);
    if line.is_empty() {
        return String::new();
    }
    cap_length(cut_at_sentence(&line))
}

/// The first trimmed, non-empty line that isn't `<example>`/`<commentary>` markup.
fn first_caption_line(full: &str) -> String {
    full.split('\n')
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('<'))
        .unwrap_or("")
        .to_string()
}

/// Cuts at the first `.`/`!`/`?` followed by whitespace or end of line, skipping
/// abbreviations (`e.g.`, `i.e.`, `etc.`, `vs.`, `cf.`) so they don't read as
/// sentence boundaries. No boundary found → the whole line.
fn cut_at_sentence(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let protected = protected_period_indices(&chars);

    for (i, &c) in chars.iter().enumerate() {
        let is_terminator = c == '.' || c == '!' || c == '?';
        if !is_terminator || protected.contains(&i) {
            continue;
        }
        let followed_by_boundary = i + 1 == chars.len() || chars[i + 1].is_whitespace();
        if followed_by_boundary {
            return chars[..=i].iter().collect();
        }
    }
    line.to_string()
}

/// Marks the `.` positions that belong to a known abbreviation, so they're
/// never mistaken for a sentence terminator.
fn protected_period_indices(chars: &[char]) -> HashSet<usize> {
    const ABBREVIATIONS: [&str; 5] = ["e.g.", "i.e.", "etc.", "vs.", "cf."];
    let mut protected = HashSet::new();

    for abbr in ABBREVIATIONS {
        let abbr_chars: Vec<char> = abbr.chars().collect();
        for start in 0..chars.len().saturating_sub(abbr_chars.len() - 1) {
            let window = &chars[start..start + abbr_chars.len()];
            if window
                .iter()
                .zip(&abbr_chars)
                .all(|(a, b)| a.eq_ignore_ascii_case(b))
            {
                for (offset, ch) in abbr_chars.iter().enumerate() {
                    if *ch == '.' {
                        protected.insert(start + offset);
                    }
                }
            }
        }
    }
    protected
}

/// Truncates to 200 characters at the last whitespace boundary and appends `…`.
fn cap_length(value: String) -> String {
    const MAX_CHARS: usize = 200;
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= MAX_CHARS {
        return value;
    }

    let mut cut = MAX_CHARS;
    while cut > 0 && !chars[cut - 1].is_whitespace() {
        cut -= 1;
    }
    if cut == 0 {
        cut = MAX_CHARS;
    }
    let mut truncated: String = chars[..cut].iter().collect();
    truncated.truncate(truncated.trim_end().len());
    truncated.push('…');
    truncated
}

#[cfg(test)]
#[path = "agent_description_tests.rs"]
mod tests;
