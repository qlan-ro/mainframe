use mainframe_adapter_api::{AdapterError, BoxFuture, SkillsProvider};
use mainframe_types::skill::*;

pub struct Provider;
impl SkillsProvider for Provider {
    fn supports_agents(&self) -> bool {
        true
    }
    fn writable(&self) -> bool {
        true
    }
    fn list_skills(&self, project: String) -> BoxFuture<'_, Result<Vec<Skill>, AdapterError>> {
        Box::pin(async move { Ok(crate::skills::list_skills(&project).await) })
    }
    fn list_agents(
        &self,
        project: String,
    ) -> BoxFuture<'_, Result<Vec<AgentConfig>, AdapterError>> {
        Box::pin(async move { Ok(crate::skills::list_agents(&project).await) })
    }
    fn create_skill(
        &self,
        project: String,
        input: CreateSkillInput,
    ) -> BoxFuture<'_, Result<Skill, AdapterError>> {
        Box::pin(async move {
            crate::skills::create_skill(&project, &input)
                .await
                .map_err(|error| AdapterError::Message(error.to_string()))
        })
    }
    fn create_agent(
        &self,
        project: String,
        input: CreateAgentInput,
    ) -> BoxFuture<'_, Result<AgentConfig, AdapterError>> {
        Box::pin(async move {
            crate::skills::create_agent(&project, &input)
                .await
                .map_err(|error| AdapterError::Message(error.to_string()))
        })
    }
    fn update_skill(
        &self,
        id: String,
        project: String,
        content: String,
    ) -> BoxFuture<'_, Result<Skill, AdapterError>> {
        Box::pin(async move {
            crate::skills::update_skill(&id, &project, &content)
                .await
                .map_err(|error| AdapterError::Message(error.to_string()))
        })
    }
    fn update_agent(
        &self,
        id: String,
        project: String,
        content: String,
    ) -> BoxFuture<'_, Result<AgentConfig, AdapterError>> {
        Box::pin(async move {
            crate::skills::update_agent(&id, &project, &content)
                .await
                .map_err(|error| AdapterError::Message(error.to_string()))
        })
    }
    fn delete_skill(&self, id: String, project: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            crate::skills::delete_skill(&id, &project)
                .await
                .map_err(|error| AdapterError::Message(error.to_string()))
        })
    }
    fn delete_agent(&self, id: String, project: String) -> BoxFuture<'_, Result<(), AdapterError>> {
        Box::pin(async move {
            crate::skills::delete_agent(&id, &project)
                .await
                .map_err(|error| AdapterError::Message(error.to_string()))
        })
    }
}
