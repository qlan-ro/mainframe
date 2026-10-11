use crate::{AdapterError, BoxFuture};
use mainframe_types::skill::{AgentConfig, CreateAgentInput, CreateSkillInput, Skill};

pub trait SkillsProvider: Send + Sync {
    fn supports_agents(&self) -> bool {
        false
    }
    fn writable(&self) -> bool {
        false
    }
    fn list_error(&self) -> &str {
        "Operation failed"
    }
    fn list_skills(&self, _project: String) -> BoxFuture<'_, Result<Vec<Skill>, AdapterError>> {
        Box::pin(async { Err(AdapterError::Unsupported("manage skills or agents")) })
    }
    fn list_agents(
        &self,
        _project: String,
    ) -> BoxFuture<'_, Result<Vec<AgentConfig>, AdapterError>> {
        Box::pin(async { Err(AdapterError::Unsupported("manage skills or agents")) })
    }
    fn create_skill(
        &self,
        _project: String,
        _input: CreateSkillInput,
    ) -> BoxFuture<'_, Result<Skill, AdapterError>> {
        Box::pin(async { Err(AdapterError::Unsupported("manage skills or agents")) })
    }
    fn create_agent(
        &self,
        _project: String,
        _input: CreateAgentInput,
    ) -> BoxFuture<'_, Result<AgentConfig, AdapterError>> {
        Box::pin(async { Err(AdapterError::Unsupported("manage skills or agents")) })
    }
    fn update_skill(
        &self,
        _id: String,
        _project: String,
        _content: String,
    ) -> BoxFuture<'_, Result<Skill, AdapterError>> {
        Box::pin(async { Err(AdapterError::Unsupported("manage skills or agents")) })
    }
    fn update_agent(
        &self,
        _id: String,
        _project: String,
        _content: String,
    ) -> BoxFuture<'_, Result<AgentConfig, AdapterError>> {
        Box::pin(async { Err(AdapterError::Unsupported("manage skills or agents")) })
    }
    fn delete_skill(
        &self,
        _id: String,
        _project: String,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Err(AdapterError::Unsupported("manage skills or agents")) })
    }
    fn delete_agent(
        &self,
        _id: String,
        _project: String,
    ) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async { Err(AdapterError::Unsupported("manage skills or agents")) })
    }
}
