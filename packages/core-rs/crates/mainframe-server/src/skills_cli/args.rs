//! Argv construction for the `skills` CLI. Every argument list is built as a
//! `Vec<String>` and handed straight to `Command::args` — no shell string is
//! ever assembled, so user input can't inject a flag by containing spaces.

use super::Scope;

/// `adapterId → --agent` value the `skills` CLI expects. Every adapter maps
/// to `claude-code` today (only Claude's skills surface exists); kept as a
/// named function so a second adapter is a one-line change instead of a
/// literal repeated at four call sites.
pub fn agent_for_adapter(_adapter_id: Option<&str>) -> &'static str {
    "claude-code"
}

pub fn list_args(scope: Scope) -> Vec<String> {
    let mut args = vec!["list".to_string(), "--json".to_string()];
    if scope == Scope::Global {
        args.push("--global".to_string());
    }
    args
}

pub fn probe_args(source: &str) -> Vec<String> {
    vec!["add".to_string(), source.to_string(), "--list".to_string()]
}

pub fn add_args(source: &str, skills: &[String], agent: &str, scope: Scope) -> Vec<String> {
    let mut args = vec!["add".to_string(), source.to_string()];
    push_skill_flags(&mut args, skills);
    push_agent_scope_yes(&mut args, agent, scope);
    args
}

pub fn remove_args(skills: &[String], agent: &str, scope: Scope) -> Vec<String> {
    let mut args = vec!["remove".to_string()];
    push_skill_flags(&mut args, skills);
    push_agent_scope_yes(&mut args, agent, scope);
    args
}

fn push_skill_flags(args: &mut Vec<String>, skills: &[String]) {
    for skill in skills {
        args.push("--skill".to_string());
        args.push(skill.clone());
    }
}

fn push_agent_scope_yes(args: &mut Vec<String>, agent: &str, scope: Scope) {
    args.push("--agent".to_string());
    args.push(agent.to_string());
    if scope == Scope::Global {
        args.push("--global".to_string());
    }
    args.push("--yes".to_string());
}
