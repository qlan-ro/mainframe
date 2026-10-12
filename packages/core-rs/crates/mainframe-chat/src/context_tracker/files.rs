use super::*;

pub(super) fn context_files(
    project_path: &str,
    adapters: &AdapterRegistry,
    session: Option<&Arc<dyn AdapterSession>>,
    adapter_id: Option<&str>,
) -> (Vec<ContextFile>, Vec<ContextFile>) {
    let mut global_files: Vec<ContextFile> = Vec::new();
    let mut project_files: Vec<ContextFile> = Vec::new();
    if let Some(session) = session {
        let files = session.get_context_files();
        global_files = files.global;
        project_files = files.project;
    } else if let Some(adapter) = adapter_id.and_then(|id| adapters.get(id))
        && let Some(files) = adapter.get_context_files(project_path)
    {
        global_files = files.global;
        project_files = files.project;
    }

    (global_files, project_files)
}
