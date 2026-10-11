//! `ExternalSessionFacade` — object-safe erasure of `ExternalSessionService<D>`.
use super::*;
use mainframe_types::seam_error::SeamError;

/// Object-safe access to the external-session service built over shared chat state.
pub trait ExternalSessionFacade: Send + Sync {
    fn start_auto_scan(&self, project_id: &str);
    fn stop_auto_scan(&self, project_id: &str);
    fn stop_all(&self);
    fn scan_page<'a>(
        &'a self,
        project_id: &'a str,
        offset: i64,
        limit: i64,
    ) -> BoxFuture<'a, Result<ExternalSessionPage, SeamError>>;
    #[allow(clippy::too_many_arguments)]
    fn import_session<'a>(
        &'a self,
        project_id: &'a str,
        session_id: &'a str,
        adapter_id: &'a str,
        title: Option<&'a str>,
        created_at: Option<&'a str>,
        modified_at: Option<&'a str>,
    ) -> BoxFuture<'a, Result<Chat, SeamError>>;
}

impl<D: ExternalSessionDeps + 'static> ExternalSessionFacade for ExternalSessionService<D> {
    fn start_auto_scan(&self, project_id: &str) {
        ExternalSessionService::start_auto_scan(self, project_id);
    }
    fn stop_auto_scan(&self, project_id: &str) {
        ExternalSessionService::stop_auto_scan(self, project_id);
    }
    fn stop_all(&self) {
        ExternalSessionService::stop_all(self);
    }
    fn scan_page<'a>(
        &'a self,
        project_id: &'a str,
        offset: i64,
        limit: i64,
    ) -> BoxFuture<'a, Result<ExternalSessionPage, SeamError>> {
        Box::pin(async move { self.scan_page(project_id, offset, limit).await })
    }
    fn import_session<'a>(
        &'a self,
        project_id: &'a str,
        session_id: &'a str,
        adapter_id: &'a str,
        title: Option<&'a str>,
        created_at: Option<&'a str>,
        modified_at: Option<&'a str>,
    ) -> BoxFuture<'a, Result<Chat, SeamError>> {
        Box::pin(async move {
            self.import_session(
                project_id,
                session_id,
                adapter_id,
                title,
                created_at,
                modified_at,
            )
            .await
        })
    }
}
