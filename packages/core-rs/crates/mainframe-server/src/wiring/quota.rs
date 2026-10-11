use super::refresh::resolve_adapter_path;
use crate::Db;
use mainframe_adapter_api::AdapterError;
use mainframe_adapter_claude::{
    quota_pull::{PullClaudeQuotaDeps, pull_claude_quota, spawn_claude_usage},
    trust_store::{CLAUDE_IDENTITY_TRANSIENT, read_claude_account_identity},
};
use mainframe_adapter_codex::{
    CODEX_IDENTITY_TRANSIENT, quota_pull::pull_codex_quota_via_temp_app_server,
    read_codex_account_identity_from_disk,
};
use mainframe_services::quota::{IdentityResolver, IngestMode, QuotaManager, QuotaPuller};
use mainframe_types::seam_error::SeamError;
use std::{future::Future, pin::Pin, sync::Arc};
pub(crate) fn register_quota_pullers(
    quota: &Arc<QuotaManager>,
    db: &Db,
    resolved_path: &mainframe_runtime::ResolvedPath,
) {
    let claude_db = db.clone();
    let claude_path = resolved_path.clone();
    let claude_puller: QuotaPuller = Arc::new(move || {
        let db = claude_db.clone();
        let resolved_path = claude_path.clone();
        Box::pin(async move {
            let binary = resolve_adapter_path(&db, &resolved_path, "claude")
                .await
                .ok_or_else(|| {
                    SeamError::new(AdapterError::Unavailable("claude executable not found"))
                })?;
            let path = resolved_path.as_str().to_string();
            let run_usage =
                move || -> Pin<Box<dyn Future<Output = Result<String, AdapterError>> + Send>> {
                    let binary = binary.clone();
                    let path = path.clone();
                    Box::pin(async move { spawn_claude_usage(&binary, &path).await })
                };
            pull_claude_quota(PullClaudeQuotaDeps {
                run_usage: &run_usage,
                read_identity: None,
                now: now_ms(),
            })
            .await
            .map_err(SeamError::new)
        })
    });
    quota.register_puller("claude", IngestMode::Pull, claude_puller);

    let codex_db = db.clone();
    let codex_path = resolved_path.clone();
    let codex_puller: QuotaPuller = Arc::new(move || {
        let db = codex_db.clone();
        let resolved_path = codex_path.clone();
        Box::pin(async move {
            let binary = resolve_adapter_path(&db, &resolved_path, "codex")
                .await
                .ok_or_else(|| {
                    SeamError::new(AdapterError::Unavailable("codex executable not found"))
                })?;
            pull_codex_quota_via_temp_app_server(&binary, resolved_path.as_str())
                .await
                .map_err(SeamError::new)
        })
    });
    // Codex reads the app-server sparsely, so its pull merges like a push.
    quota.register_puller("codex", IngestMode::Push, codex_puller);
}

pub(crate) fn register_quota_identity_resolvers(quota: &Arc<QuotaManager>) {
    let claude_resolver: IdentityResolver = Arc::new(|| {
        Box::pin(async {
            let identity = read_claude_account_identity(None).await;
            (identity != CLAUDE_IDENTITY_TRANSIENT).then_some(identity)
        })
    });
    quota.register_identity_resolver("claude", claude_resolver);

    let codex_resolver: IdentityResolver = Arc::new(|| {
        Box::pin(async {
            let identity = read_codex_account_identity_from_disk().await;
            (identity != CODEX_IDENTITY_TRANSIENT).then_some(identity)
        })
    });
    quota.register_identity_resolver("codex", codex_resolver);
}

use mainframe_types::time::now_ms;
