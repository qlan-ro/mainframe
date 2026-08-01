//! `ExternalSessionFacade` — object-safe erasure of `ExternalSessionService<D>`.
use super::*;

/// Object-safe facade over `ExternalSessionService<D>` (`ctx.chats.
/// getExternalSessionService()`). `ChatManager` only ever holds the
/// already-erased `Arc<dyn ChatManagerDeps>`, so the generic service is built
/// once at boot from the concrete deps type (see
/// `mainframe_server::chat_deps::build_chat_manager`, where that type is still
/// known) and injected here pre-erased via [`ChatManager::with_external_sessions`].
pub trait ExternalSessionFacade: Send + Sync {
    fn start_auto_scan(&self, project_id: &str);
    fn stop_auto_scan(&self, project_id: &str);
    fn stop_all(&self);
    fn scan_page<'a>(
        &'a self,
        project_id: &'a str,
        offset: i64,
        limit: i64,
    ) -> BoxFuture<'a, ExternalSessionPage>;
    #[allow(clippy::too_many_arguments)]
    fn import_session<'a>(
        &'a self,
        project_id: &'a str,
        session_id: &'a str,
        adapter_id: &'a str,
        title: Option<&'a str>,
        created_at: Option<&'a str>,
        modified_at: Option<&'a str>,
    ) -> BoxFuture<'a, Chat>;
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
    ) -> BoxFuture<'a, ExternalSessionPage> {
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
    ) -> BoxFuture<'a, Chat> {
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
