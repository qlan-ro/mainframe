use mainframe_adapter_api::{AdapterError, BoxFuture, SkillsProvider};
use mainframe_types::skill::*;

pub struct Provider(pub mainframe_runtime::ResolvedPath);
impl SkillsProvider for Provider {
    fn list_error(&self) -> &str {
        "Failed to list Codex skills"
    }
    fn list_skills(&self, project: String) -> BoxFuture<'_, Result<Vec<Skill>, AdapterError>> {
        Box::pin(async move { crate::skills::list_skills(&project, self.0.as_str()).await })
    }
}
