use mainframe_adapter_api::{AdapterError, BoxFuture, SkillsProvider};
use mainframe_types::skill::*;

pub struct Provider;
impl SkillsProvider for Provider {
    fn supports_agents(&self) -> bool {
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
}
