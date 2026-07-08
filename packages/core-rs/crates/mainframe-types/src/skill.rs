//! Ported from `packages/types/src/skill.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillScope {
    Project,
    Global,
    Plugin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentScope {
    Project,
    Global,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub adapter_id: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub scope: SkillScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_name: Option<String>,
    pub file_path: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invocation_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub id: String,
    pub adapter_id: String,
    pub name: String,
    pub description: String,
    pub scope: AgentScope,
    pub file_path: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSkillInput {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub content: String,
    pub scope: AgentScope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentInput {
    pub name: String,
    pub description: String,
    pub content: String,
    pub scope: AgentScope,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_omits_optionals_when_absent() {
        let json = r#"{"id":"s1","adapterId":"claude","name":"review","displayName":"Review","description":"d","scope":"plugin","filePath":"/p","content":"c"}"#;
        let s: Skill = serde_json::from_str(json).unwrap();
        assert_eq!(s.scope, SkillScope::Plugin);
        assert!(s.plugin_name.is_none());
        assert_eq!(serde_json::to_string(&s).unwrap(), json);
    }

    #[test]
    fn agent_config_round_trips() {
        let json = r#"{"id":"a1","adapterId":"claude","name":"planner","description":"d","scope":"global","filePath":"/p","content":"c"}"#;
        let a: AgentConfig = serde_json::from_str(json).unwrap();
        assert_eq!(a.scope, AgentScope::Global);
        assert_eq!(serde_json::to_string(&a).unwrap(), json);
    }
}

// PORT STATUS: packages/types/src/skill.ts (37 lines)
// confidence: high
// todos: 0
// notes: `scope` literal-unions → SkillScope (project|global|plugin) and AgentScope
// (project|global). CreateSkillInput/CreateAgentInput reuse AgentScope (the TS
// inline `'project' | 'global'`). Optional pluginName/invocationName → Option +
// skip_serializing_if.
