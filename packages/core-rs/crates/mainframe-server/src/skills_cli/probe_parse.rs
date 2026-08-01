//! Parses the `skills` CLI's TUI probe output (`add <source> --list`) into
//! structured skill candidates. Anything unreadable degrades to
//! `Unparseable` — the UI falls back to manual skill-name entry rather than
//! showing a broken list.
//!
//! The CLI prints an `Available Skills` banner, then one block per category:
//! a bare category heading, followed by gutter-prefixed lines where the skill
//! name is indented 4 columns and its description 6.
//!
//! ```text
//! ◇  Available Skills
//! Document Skills
//! │
//! │    docx
//! │
//! │      Use this skill whenever the user wants to …
//! └  Use --skill <name> to install specific skills
//! ```

use super::run::strip_ansi;
use super::{ProbeOutcome, ProbedSkill};

const LIST_BANNER: &str = "Available Skills";
const GUTTER: char = '│';
const DESCRIPTION_INDENT: usize = 6;

pub fn parse_probe(raw: &str) -> ProbeOutcome {
    let stripped = strip_ansi(raw);
    if stripped.trim().is_empty() {
        return ProbeOutcome::Probed { skills: Vec::new() };
    }
    let Some((_, listing)) = stripped.split_once(LIST_BANNER) else {
        return ProbeOutcome::Unparseable;
    };

    let mut skills: Vec<ProbedSkill> = Vec::new();
    for line in listing.lines() {
        // Category headings and the closing hint carry no gutter; skip them.
        let Some(entry) = line.strip_prefix(GUTTER) else {
            continue;
        };
        let text = entry.trim();
        if text.is_empty() {
            continue;
        }
        let indent = entry.len() - entry.trim_start().len();
        if indent >= DESCRIPTION_INDENT {
            if let Some(skill) = skills.last_mut() {
                push_description(skill, text);
            }
        } else if is_skill_name(text) {
            skills.push(ProbedSkill {
                name: text.to_string(),
                description: None,
            });
        }
    }

    if skills.is_empty() {
        return ProbeOutcome::Unparseable;
    }
    ProbeOutcome::Probed { skills }
}

fn push_description(skill: &mut ProbedSkill, text: &str) {
    match skill.description.as_mut() {
        Some(existing) => {
            existing.push(' ');
            existing.push_str(text);
        }
        None => skill.description = Some(text.to_string()),
    }
}

fn is_skill_name(text: &str) -> bool {
    !text.is_empty()
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}
