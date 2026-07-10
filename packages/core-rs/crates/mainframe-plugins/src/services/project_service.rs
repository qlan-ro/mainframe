//! Ported from `packages/core/src/plugins/services/project-service.ts`.

use std::sync::Arc;

use mainframe_adapter_api::BoxFuture;
use mainframe_types::chat::Project;
use mainframe_types::plugin::ProjectSummary;

use crate::PluginError;
use crate::context::{PluginHostDb, ProjectService};

struct HostProjectService {
    host_db: Arc<dyn PluginHostDb>,
}

/// `buildProjectService(db)`.
pub fn build_project_service(host_db: Arc<dyn PluginHostDb>) -> Arc<dyn ProjectService> {
    Arc::new(HostProjectService { host_db })
}

/// `{ id, name, path }`.
fn to_summary(p: &Project) -> ProjectSummary {
    ProjectSummary {
        id: p.id.clone(),
        name: p.name.clone(),
        path: p.path.clone(),
    }
}

impl ProjectService for HostProjectService {
    fn list_projects(&self) -> BoxFuture<'_, Result<Vec<ProjectSummary>, PluginError>> {
        Box::pin(async move {
            Ok(self
                .host_db
                .projects_list()
                .iter()
                .map(to_summary)
                .collect())
        })
    }

    fn get_project_by_id(
        &self,
        id: &str,
    ) -> BoxFuture<'_, Result<Option<ProjectSummary>, PluginError>> {
        let id = id.to_string();
        Box::pin(async move { Ok(self.host_db.projects_get(&id).as_ref().map(to_summary)) })
    }
}

// PORT STATUS: src/plugins/services/project-service.ts
// confidence: high
// todos: 0
// notes: maps Project→ProjectSummary { id, name, path }.
