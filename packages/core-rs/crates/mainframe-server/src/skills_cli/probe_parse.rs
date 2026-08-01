//! Parses the `skills` CLI's TUI probe output (`add <source> --list`) into
//! structured skill candidates. Anything unreadable degrades to
//! `Unparseable` — the UI falls back to manual skill-name entry rather than
//! showing a broken list.

use super::run::strip_ansi;
use super::{ProbeOutcome, ProbedSkill};

pub fn parse_probe(raw: &str) -> ProbeOutcome {
    let stripped = strip_ansi(raw);
    let skills: Vec<ProbedSkill> = stripped
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !is_decorative(line))
        .filter_map(parse_line)
        .collect();

    if skills.is_empty() && stripped.trim().is_empty() {
        return ProbeOutcome::Probed { skills };
    }
    if skills.is_empty() {
        return ProbeOutcome::Unparseable;
    }
    ProbeOutcome::Probed { skills }
}

fn is_decorative(line: &str) -> bool {
    !line.chars().any(char::is_alphanumeric)
}

fn parse_line(line: &str) -> Option<ProbedSkill> {
    for sep in [" — ", ": "] {
        if let Some((name, desc)) = line.split_once(sep) {
            let name = name.trim();
            if name.is_empty() {
                continue;
            }
            let desc = desc.trim();
            return Some(ProbedSkill {
                name: name.to_string(),
                description: (!desc.is_empty()).then(|| desc.to_string()),
            });
        }
    }
    // Bare-name line: no separator, but it reads as a plain skill name.
    line.chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' '))
        .then(|| ProbedSkill {
            name: line.to_string(),
            description: None,
        })
}
