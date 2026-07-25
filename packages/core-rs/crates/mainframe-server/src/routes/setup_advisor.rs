//! `GET /api/projects/{id}/automation-recommendations` — fingerprints the
//! registered project and maps the result through the Setup Advisor rules
//! dataset. Mirrors `routes/suggestions.rs`'s handler shape.

use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::extract::{Path as AxPath, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use mainframe_types::setup_advisor::SetupAdvisorReport;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::files::resolve_base;
use crate::setup_advisor;

async fn handle_automation_recommendations(ctx: &AppCtx, id: &str) -> Response {
    let base_path = match resolve_base(ctx, id, None).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };

    let is_dir = tokio::fs::metadata(&base_path)
        .await
        .is_ok_and(|meta| meta.is_dir());
    if !is_dir {
        return fail(StatusCode::NOT_FOUND, "Project path not found");
    }

    let fingerprint = setup_advisor::fingerprint(Path::new(&base_path)).await;
    let recommendations = setup_advisor::recommend(&fingerprint);
    ok(SetupAdvisorReport {
        fingerprint,
        recommendations,
    })
}

async fn get_automation_recommendations(
    State(ctx): State<Arc<AppCtx>>,
    AxPath(id): AxPath<String>,
) -> Response {
    handle_automation_recommendations(&ctx, &id).await
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route(
        "/api/projects/{id}/automation-recommendations",
        get(get_automation_recommendations),
    )
}
