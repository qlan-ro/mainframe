use crate::{Db, ctx::DefaultRunner};
use mainframe_adapter_api::{
    BoxFuture, RefreshDeps, RunResult,
    resolve_executable::{ResolverDeps, resolve_adapter_executable},
};
use mainframe_types::events::DaemonEvent;
use tokio::sync::broadcast;
pub(crate) struct DaemonRefreshDeps {
    pub(crate) db: Db,
    pub(crate) broadcast: broadcast::Sender<DaemonEvent>,
    pub(crate) resolved_path: mainframe_runtime::ResolvedPath,
}

impl RefreshDeps for DaemonRefreshDeps {
    fn resolve_executable_path(&self, adapter_id: String) -> BoxFuture<'_, Option<String>> {
        let db = self.db.clone();
        let resolved_path = self.resolved_path.clone();
        Box::pin(async move { resolve_adapter_path(&db, &resolved_path, &adapter_id).await })
    }

    fn run(
        &self,
        cmd: String,
        args: Vec<String>,
        timeout_ms: Option<u64>,
    ) -> BoxFuture<'_, RunResult> {
        let path = self.resolved_path.clone();
        Box::pin(async move {
            mainframe_adapter_api::resolve_executable::default_run(
                &cmd,
                &args,
                timeout_ms,
                Some(path.as_str()),
            )
            .await
        })
    }

    fn emit_event(&self, event: DaemonEvent) {
        let _ = self.broadcast.send(event);
    }
}

pub(crate) async fn resolve_adapter_path(
    db: &Db,
    resolved_path: &mainframe_runtime::ResolvedPath,
    adapter_id: &str,
) -> Option<String> {
    let runner = DefaultRunner::new(resolved_path.clone());
    let resolved = resolve_adapter_executable(
        adapter_id,
        &ResolverDeps {
            settings: db,
            run: &runner,
            path: resolved_path,
        },
    )
    .await;
    resolved.valid.then_some(resolved.path)
}
