//! Scans `.claude/{skills,commands,agents}` (project + global + installed
//! plugins) for SKILL.md / command / agent markdown, and the CRUD helpers that
//! create/update/delete them. Frontmatter is read/written via `crate::frontmatter`.
//!
//! Split into `skills/{scan,crud,agents}.rs` (todo #317, Decision D1) to stay
//! under the 300-line file cap; this file is the facade holding the shared
//! error type, path/scope helpers, and re-exports of their public API.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use mainframe_types::skill::{AgentScope, SkillScope};
use tokio::fs;

mod agents;
mod crud;
mod scan;

pub use agents::{create_agent, delete_agent, list_agents, update_agent};
pub use crud::{create_skill, delete_skill, update_skill};
pub use scan::list_skills;

pub(crate) const ADAPTER_ID: &str = "claude";

#[derive(Debug, thiserror::Error)]
pub enum SkillsError {
    #[error("Skill not found: {0}")]
    SkillNotFound(String),
    #[error("Agent not found: {0}")]
    AgentNotFound(String),
    #[error("Cannot delete plugin skills")]
    CannotDeletePluginSkills,
    #[error("{0}")]
    Io(String),
}

impl From<std::io::Error> for SkillsError {
    fn from(e: std::io::Error) -> Self {
        SkillsError::Io(e.to_string())
    }
}

pub(crate) fn skill_scope_str(scope: SkillScope) -> &'static str {
    match scope {
        SkillScope::Project => "project",
        SkillScope::Global => "global",
        SkillScope::Plugin => "plugin",
    }
}

pub(crate) fn agent_scope_str(scope: AgentScope) -> &'static str {
    match scope {
        AgentScope::Project => "project",
        AgentScope::Global => "global",
    }
}

pub(crate) fn agent_to_skill_scope(scope: AgentScope) -> SkillScope {
    match scope {
        AgentScope::Project => SkillScope::Project,
        AgentScope::Global => SkillScope::Global,
    }
}

pub(crate) fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}

/// `readdir(dir)` returning just the entry names — `None` on any error (the TS
/// `try { … } catch { return }`).
pub(crate) async fn read_dir_names(dir: &Path) -> Option<Vec<String>> {
    let mut rd = match fs::read_dir(dir).await {
        Ok(rd) => rd,
        Err(_) => return None, /* expected: directory absent */
    };
    let mut names = Vec::new();
    loop {
        match rd.next_entry().await {
            Ok(Some(entry)) => names.push(entry.file_name().to_string_lossy().into_owned()),
            Ok(None) => break,
            Err(_) => return None,
        }
    }
    Some(names)
}

/// `attributes['name'] || fallback` — a present-but-empty value falls back too.
pub(crate) fn nonempty_attr(attributes: &HashMap<String, String>, key: &str) -> Option<String> {
    attributes.get(key).filter(|v| !v.is_empty()).cloned()
}
